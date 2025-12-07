#!/usr/bin/env python3
"""
临时修复脚本：重置因 Celery 失败而错误扣减的兑换码使用次数

使用方法：
    python scripts/reset_failed_redeem.py <兑换码>
"""

import sys
sys.path.insert(0, '/app')

from app.database import SessionLocal
from app.models import RedeemCode, InviteRecord
from sqlalchemy import update

def reset_redeem_code(code: str):
    """重置兑换码的使用次数"""
    db = SessionLocal()
    try:
        # 查找兑换码
        redeem_code = db.query(RedeemCode).filter(
            RedeemCode.code == code.upper().strip()
        ).first()

        if not redeem_code:
            print(f"❌ 兑换码 {code} 不存在")
            return

        # 统计成功的邀请记录数
        success_count = db.query(InviteRecord).filter(
            InviteRecord.redeem_code == redeem_code.code,
            InviteRecord.status == 'SUCCESS'
        ).count()

        print(f"📊 兑换码信息：")
        print(f"   代码：{redeem_code.code}")
        print(f"   当前使用次数：{redeem_code.used_count}")
        print(f"   实际成功邀请：{success_count}")
        print(f"   最大使用次数：{redeem_code.max_uses}")
        print(f"   绑定邮箱：{redeem_code.bound_email or '未绑定'}")

        if redeem_code.used_count == success_count:
            print(f"✅ 使用次数正确，无需修复")
            return

        # 重置为实际成功次数
        db.execute(
            update(RedeemCode)
            .where(RedeemCode.id == redeem_code.id)
            .values(used_count=success_count)
        )
        db.commit()

        print(f"✅ 已重置使用次数：{redeem_code.used_count} → {success_count}")

    except Exception as e:
        db.rollback()
        print(f"❌ 重置失败：{e}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("使用方法：python scripts/reset_failed_redeem.py <兑换码>")
        sys.exit(1)

    code = sys.argv[1]
    reset_redeem_code(code)
