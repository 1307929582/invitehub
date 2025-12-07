#!/usr/bin/env python3
"""
数据迁移脚本：初始化现有兑换码的换车相关字段

此脚本是幂等的，可以安全地多次运行。它会：
1. 为所有现有兑换码设置 rebind_count=0, rebind_limit=3
2. 根据激活状态和过期时间智能推断 status
3. 调整 validity_days 到 31-35 天范围（容错）
4. 打印详细的处理日志

运行方式：
    cd /Users/xmdbd/项目/team自助/invitehub/backend
    python scripts/migrate_existing_codes.py
"""

import sys
import os
from datetime import datetime, timedelta

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker
from app.models import RedeemCode, RedeemCodeStatus
from app.config import settings


def migrate_existing_codes():
    """迁移现有兑换码数据"""
    print("=" * 80)
    print("开始迁移现有兑换码数据...")
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

        for code in codes:
            needs_update = False
            updates = {}

            # 1. 初始化 rebind_count（如果为 NULL）
            if code.rebind_count is None:
                updates['rebind_count'] = 0
                needs_update = True

            # 2. 初始化 rebind_limit（如果为 NULL）
            if code.rebind_limit is None:
                updates['rebind_limit'] = 3
                needs_update = True

            # 3. 智能推断 status（如果为 NULL）
            if code.status is None:
                if code.activated_at is None:
                    # 从未激活过的码：设为 bound（等待激活）
                    updates['status'] = RedeemCodeStatus.BOUND.value
                elif code.is_user_expired:
                    # 已激活且已过期：设为 removed
                    updates['status'] = RedeemCodeStatus.REMOVED.value
                    updates['removed_at'] = code.user_expires_at  # 记录过期时间
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

                # 打印详细日志
                status_str = updates.get('status', code.status or 'N/A')
                rebind_info = f"rebind: {updates.get('rebind_count', code.rebind_count or 0)}/{updates.get('rebind_limit', code.rebind_limit or 3)}"
                activated = "已激活" if code.activated_at else "未激活"
                expired = "已过期" if code.is_user_expired else "未过期"

                print(f"  [{code.code}] {activated}, {expired} -> status={status_str}, {rebind_info}")

        # 提交事务
        db.commit()

        print("\n" + "=" * 80)
        print(f"迁移完成！")
        print(f"  - 检查兑换码数: {len(codes)}")
        print(f"  - 更新兑换码数: {updated_count}")
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
