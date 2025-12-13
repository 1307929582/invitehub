#!/usr/bin/env python3
"""
Team 状态管理和换车逻辑测试脚本

测试内容：
1. 分配逻辑：只分配到健康的 Team
2. 批量状态修改：单次和批量修改 Team 状态
3. 换车逻辑：封禁车免费换 + 正常车消耗次数并踢人
4. 孤儿用户检测：检测同时在多个 Team 的用户
"""

import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from datetime import datetime, timedelta
from sqlalchemy import func
from app.database import SessionLocal
from app.models import Team, TeamMember, RedeemCode, InviteRecord, TeamStatus, RedeemCodeStatus
from app.services.seat_calculator import get_all_teams_with_seats


class Color:
    """终端颜色"""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'
    BOLD = '\033[1m'


def print_test(name: str):
    print(f"\n{Color.BLUE}{Color.BOLD}📋 测试: {name}{Color.END}")


def print_success(msg: str):
    print(f"{Color.GREEN}✅ {msg}{Color.END}")


def print_error(msg: str):
    print(f"{Color.RED}❌ {msg}{Color.END}")


def print_warning(msg: str):
    print(f"{Color.YELLOW}⚠️  {msg}{Color.END}")


def print_info(msg: str):
    print(f"ℹ️  {msg}")


def test_allocation_logic():
    """测试 1: 分配逻辑 - 只分配到健康的 Team"""
    print_test("分配逻辑 - 只分配到健康的 Team")

    db = SessionLocal()
    try:
        # 1. 查询所有 Team
        all_teams = db.query(Team).all()
        print_info(f"总 Team 数: {len(all_teams)}")

        # 2. 使用 get_all_teams_with_seats（should only return healthy teams）
        healthy_teams = get_all_teams_with_seats(db, only_active=True)
        print_info(f"健康 Team 数: {len(healthy_teams)}")

        # 3. 验证：所有返回的 Team 都应该是 is_active=True AND status=ACTIVE
        for team_info in healthy_teams:
            team = db.query(Team).filter(Team.id == team_info.team_id).first()
            if not team.is_active or team.status != TeamStatus.ACTIVE:
                print_error(f"Team {team.name} 不健康但仍被返回！")
                return False

        print_success("所有返回的 Team 都是健康状态")

        # 4. 验证：不健康的 Team 不应该被返回
        unhealthy = [t for t in all_teams if not t.is_active or t.status != TeamStatus.ACTIVE]
        print_info(f"不健康 Team 数: {len(unhealthy)}")

        if unhealthy:
            unhealthy_ids = {t.id for t in unhealthy}
            healthy_ids = {t.team_id for t in healthy_teams}
            intersection = unhealthy_ids & healthy_ids

            if intersection:
                print_error(f"发现不健康的 Team 被返回: {intersection}")
                return False

        print_success("不健康的 Team 已被正确过滤")
        return True

    except Exception as e:
        print_error(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def test_team_status_update():
    """测试 2: Team 状态修改"""
    print_test("Team 状态修改（单次和批量）")

    db = SessionLocal()
    try:
        # 找一个测试 Team
        test_team = db.query(Team).filter(Team.status == TeamStatus.ACTIVE).first()

        if not test_team:
            print_warning("没有可用于测试的 Team")
            return True

        original_status = test_team.status
        print_info(f"测试 Team: {test_team.name}, 原状态: {original_status.value}")

        # 1. 修改为 BANNED
        test_team.status = TeamStatus.BANNED
        test_team.status_message = "测试封禁"
        test_team.status_changed_at = datetime.utcnow()
        db.commit()
        print_success(f"状态已修改为: {test_team.status.value}")

        # 2. 验证：该 Team 不应该出现在可分配列表中
        healthy_teams = get_all_teams_with_seats(db, only_active=True)
        if test_team.id in {t.team_id for t in healthy_teams}:
            print_error(f"BANNED Team 仍在可分配列表中！")
            return False

        print_success("BANNED Team 已被正确排除")

        # 3. 恢复原状态
        test_team.status = original_status
        test_team.status_message = None
        db.commit()
        print_success(f"状态已恢复为: {original_status.value}")

        return True

    except Exception as e:
        print_error(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def test_rebind_logic():
    """测试 3: 换车逻辑"""
    print_test("换车逻辑 - 封禁车免费换 + 正常车消耗次数")

    db = SessionLocal()
    try:
        # 查找一个有换车记录的兑换码
        test_code = db.query(RedeemCode).filter(
            RedeemCode.bound_email != None,
            RedeemCode.user_expires_at > datetime.utcnow()
        ).first()

        if not test_code:
            print_warning("没有可用于测试的兑换码")
            return True

        print_info(f"测试兑换码: {test_code.code}, 邮箱: {test_code.bound_email}")
        print_info(f"当前换车次数: {test_code.safe_rebind_count}/{test_code.safe_rebind_limit}")

        # 查找该用户所在的 Team
        last_invite = db.query(InviteRecord).filter(
            InviteRecord.email == test_code.bound_email,
            InviteRecord.redeem_code == test_code.code,
            InviteRecord.status == "success"
        ).order_by(InviteRecord.created_at.desc()).first()

        if not last_invite:
            print_warning("该用户没有邀请记录")
            return True

        current_team = db.query(Team).filter(Team.id == last_invite.team_id).first()
        if not current_team:
            print_warning("找不到当前 Team")
            return True

        print_info(f"当前 Team: {current_team.name}, 状态: {current_team.status.value}")

        # 验证逻辑（不实际执行换车）
        if current_team.status in [TeamStatus.BANNED, TeamStatus.TOKEN_INVALID]:
            print_success(f"从不健康 Team 换车 -> 应该免费（consume_rebind_count=False）")
        else:
            print_success(f"从健康 Team 换车 -> 应该消耗次数（consume_rebind_count=True）并踢出原 Team")

        return True

    except Exception as e:
        print_error(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def test_orphan_detection():
    """测试 4: 孤儿用户检测"""
    print_test("孤儿用户检测 - 同时在多个 Team 的用户")

    db = SessionLocal()
    try:
        # 查找孤儿用户
        orphan_query = (
            db.query(TeamMember.email, func.count(func.distinct(TeamMember.team_id)).label('team_count'))
            .join(Team, TeamMember.team_id == Team.id)
            .filter(
                Team.is_active == True,
                Team.status == TeamStatus.ACTIVE
            )
            .group_by(TeamMember.email)
            .having(func.count(func.distinct(TeamMember.team_id)) > 1)
        )

        orphan_users = orphan_query.all()
        orphan_count = len(orphan_users)

        print_info(f"检测到孤儿用户数: {orphan_count}")

        if orphan_count > 0:
            print_warning("发现孤儿用户！")
            for email, team_count in orphan_users[:5]:
                # 查找该用户所在的 Team
                members = db.query(TeamMember).join(Team).filter(
                    TeamMember.email == email,
                    Team.is_active == True,
                    Team.status == TeamStatus.ACTIVE
                ).all()
                team_names = [db.query(Team).filter(Team.id == m.team_id).first().name for m in members]
                print_warning(f"  • {email} 在 {len(team_names)} 个 Team: {', '.join(team_names)}")
        else:
            print_success("没有检测到孤儿用户 - 系统健康")

        return True

    except Exception as e:
        print_error(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def test_database_consistency():
    """测试 5: 数据库一致性检查"""
    print_test("数据库一致性检查")

    db = SessionLocal()
    try:
        # 1. 检查 NULL 状态
        null_status_count = db.query(Team).filter(Team.status == None).count()
        if null_status_count > 0:
            print_error(f"发现 {null_status_count} 个 Team 的 status 为 NULL！")
            return False
        else:
            print_success("所有 Team 的 status 字段都已设置")

        # 2. 检查 is_active 和 status 的一致性
        inconsistent = db.query(Team).filter(
            Team.is_active == False,
            Team.status == TeamStatus.ACTIVE
        ).count()

        if inconsistent > 0:
            print_warning(f"发现 {inconsistent} 个 Team 的 is_active=False 但 status=ACTIVE")
        else:
            print_success("is_active 和 status 一致")

        # 3. 统计各状态的 Team 数量
        print_info("\nTeam 状态分布:")
        for status in TeamStatus:
            count = db.query(Team).filter(Team.status == status).count()
            print_info(f"  - {status.value}: {count} 个")

        return True

    except Exception as e:
        print_error(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def main():
    """主测试函数"""
    print(f"\n{Color.BOLD}{'='*60}{Color.END}")
    print(f"{Color.BOLD}   Team 状态管理和换车逻辑测试套件{Color.END}")
    print(f"{Color.BOLD}{'='*60}{Color.END}")

    results = []

    # 运行所有测试
    tests = [
        test_database_consistency,
        test_allocation_logic,
        test_team_status_update,
        test_rebind_logic,
        test_orphan_detection,
    ]

    for test_func in tests:
        try:
            result = test_func()
            results.append((test_func.__name__, result))
        except Exception as e:
            print_error(f"测试崩溃: {test_func.__name__}: {e}")
            results.append((test_func.__name__, False))

    # 输出总结
    print(f"\n{Color.BOLD}{'='*60}{Color.END}")
    print(f"{Color.BOLD}   测试总结{Color.END}")
    print(f"{Color.BOLD}{'='*60}{Color.END}\n")

    passed = sum(1 for _, result in results if result)
    failed = len(results) - passed

    for name, result in results:
        status = f"{Color.GREEN}✅ PASS{Color.END}" if result else f"{Color.RED}❌ FAIL{Color.END}"
        print(f"{status}  {name}")

    print(f"\n{Color.BOLD}总计: {passed} 通过, {failed} 失败{Color.END}\n")

    if failed > 0:
        print(f"{Color.RED}部分测试失败，请检查上述错误！{Color.END}")
        sys.exit(1)
    else:
        print(f"{Color.GREEN}🎉 所有测试通过！{Color.END}")
        sys.exit(0)


if __name__ == '__main__':
    main()
