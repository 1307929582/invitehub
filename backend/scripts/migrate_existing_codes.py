#!/usr/bin/env python3
"""
数据迁移脚本：初始化现有兑换码的商业版字段

此脚本是幂等的，可以安全地多次运行。它会：
1. 为所有现有兑换码设置 rebind_count=0, rebind_limit=3
2. 根据激活状态和过期时间智能推断 status
3. 调整 validity_days 到 31-35 天范围（容错）
4. 【重要】从 InviteRecord 回填 activated_at 和 bound_email
5. 打印详细的处理日志

运行方式：
    cd /Users/xmdbd/项目/team自助/invitehub/backend
    python scripts/migrate_existing_codes.py
"""

import sys
import os
from datetime import datetime, timedelta

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, update, func
from sqlalchemy.orm import sessionmaker
from app.models import RedeemCode, RedeemCodeStatus, InviteRecord, InviteStatus, InviteQueue
from app.config import settings


def backfill_activation_info(db, code) -> dict:
    """
    从 InviteRecord/InviteQueue 回填 activated_at 和 bound_email

    返回需要更新的字段字典
    """
    updates = {}

    # 如果 used_count > 0 但 activated_at 为空，说明是旧数据需要回填
    if code.used_count > 0 and code.activated_at is None:
        # 1. 先从 InviteRecord 查找最早的成功邀请
        earliest_invite = db.query(InviteRecord).filter(
            InviteRecord.redeem_code == code.code,
            InviteRecord.status == InviteStatus.SUCCESS
        ).order_by(InviteRecord.created_at.asc()).first()

        if earliest_invite:
            updates['activated_at'] = earliest_invite.created_at
            if not code.bound_email:
                updates['bound_email'] = earliest_invite.email.lower()
            return updates

        # 2. 如果没有成功的邀请记录，从 InviteQueue 查找
        earliest_queue = db.query(InviteQueue).filter(
            InviteQueue.redeem_code == code.code
        ).order_by(InviteQueue.created_at.asc()).first()

        if earliest_queue:
            updates['activated_at'] = earliest_queue.created_at
            if not code.bound_email:
                updates['bound_email'] = earliest_queue.email.lower()
            return updates

        # 3. 如果都没有，使用创建时间作为激活时间（保守估计）
        updates['activated_at'] = code.created_at

    # 如果有 activated_at 但没有 bound_email，尝试从邀请记录回填
    if code.activated_at and not code.bound_email:
        earliest_invite = db.query(InviteRecord).filter(
            InviteRecord.redeem_code == code.code
        ).order_by(InviteRecord.created_at.asc()).first()

        if earliest_invite:
            updates['bound_email'] = earliest_invite.email.lower()
        else:
            earliest_queue = db.query(InviteQueue).filter(
                InviteQueue.redeem_code == code.code
            ).order_by(InviteQueue.created_at.asc()).first()

            if earliest_queue:
                updates['bound_email'] = earliest_queue.email.lower()

    return updates


def migrate_existing_codes():
    """迁移现有兑换码数据"""
    print("=" * 80)
    print("开始迁移现有兑换码数据（商业版字段初始化）...")
    print("=" * 80)

    # 创建数据库连接
    engine = create_engine(settings.DATABASE_URL)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # 查询所有兑换码
        codes = db.query(RedeemCode).all()
        print(f"\n发现 {len(codes)} 个兑换码需要检查")

        updated_count = 0
        adjusted_validity_count = 0
        backfilled_activation_count = 0
        backfilled_email_count = 0

        for code in codes:
            needs_update = False
            updates = {}

            # 【重要】0. 从 InviteRecord 回填 activated_at 和 bound_email
            backfill_updates = backfill_activation_info(db, code)
            if backfill_updates:
                updates.update(backfill_updates)
                needs_update = True
                if 'activated_at' in backfill_updates:
                    backfilled_activation_count += 1
                    print(f"  [{code.code}] 回填激活时间: {backfill_updates['activated_at']}")
                if 'bound_email' in backfill_updates:
                    backfilled_email_count += 1
                    print(f"  [{code.code}] 回填绑定邮箱: {backfill_updates['bound_email'][:3]}***")

            # 1. 初始化 rebind_count（如果为 NULL）
            if code.rebind_count is None:
                updates['rebind_count'] = 0
                needs_update = True

            # 2. 初始化 rebind_limit（如果为 NULL）
            if code.rebind_limit is None:
                updates['rebind_limit'] = 3
                needs_update = True

            # 3. 智能推断 status（如果为 NULL）
            # 注意：需要考虑刚刚回填的 activated_at
            effective_activated_at = updates.get('activated_at', code.activated_at)
            if code.status is None:
                if effective_activated_at is None:
                    # 从未激活过的码：设为 bound（等待激活）
                    updates['status'] = RedeemCodeStatus.BOUND.value
                else:
                    # 计算是否过期
                    validity_days = code.validity_days or 30
                    expires_at = effective_activated_at + timedelta(days=validity_days)
                    is_expired = datetime.utcnow() > expires_at

                    if is_expired:
                        # 已激活且已过期：设为 removed
                        updates['status'] = RedeemCodeStatus.REMOVED.value
                        updates['removed_at'] = expires_at
                    else:
                        # 已激活且未过期：设为 bound
                        updates['status'] = RedeemCodeStatus.BOUND.value
                needs_update = True

            # 4. 调整 validity_days 到 31-35 天范围（容错）
            if code.validity_days is not None and code.validity_days < 31:
                old_days = code.validity_days
                # 调整到 33 天（中间值）
                updates['validity_days'] = 33
                adjusted_validity_count += 1
                print(f"  [{code.code}] 调整有效期: {old_days} 天 -> 33 天")

            # 执行更新
            if needs_update:
                db.execute(
                    update(RedeemCode)
                    .where(RedeemCode.id == code.id)
                    .values(**updates)
                )
                updated_count += 1

                # 打印详细日志（排除已打印的回填信息）
                if 'status' in updates or 'rebind_count' in updates or 'rebind_limit' in updates:
                    status_str = updates.get('status', code.status or 'N/A')
                    rebind_info = f"rebind: {updates.get('rebind_count', code.rebind_count or 0)}/{updates.get('rebind_limit', code.rebind_limit or 3)}"
                    activated = "已激活" if (updates.get('activated_at') or code.activated_at) else "未激活"

                    print(f"  [{code.code}] {activated} -> status={status_str}, {rebind_info}")

        # 提交事务
        db.commit()

        print("\n" + "=" * 80)
        print(f"迁移完成！")
        print(f"  - 检查兑换码数: {len(codes)}")
        print(f"  - 更新兑换码数: {updated_count}")
        print(f"  - 回填激活时间: {backfilled_activation_count}")
        print(f"  - 回填绑定邮箱: {backfilled_email_count}")
        print(f"  - 调整有效期数: {adjusted_validity_count}")
        print("=" * 80)

    except Exception as e:
        db.rollback()
        print(f"\n❌ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

    return True


if __name__ == "__main__":
    success = migrate_existing_codes()
    sys.exit(0 if success else 1)
