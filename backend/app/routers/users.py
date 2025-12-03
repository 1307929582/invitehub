# LinuxDO 用户管理 API - 已废弃
# 商业版已移除 LinuxDO OAuth 依赖，此路由不再使用
# 保留文件以避免导入错误，后续版本将完全删除

from fastapi import APIRouter

router = APIRouter(prefix="/linuxdo-users", tags=["linuxdo-users"])

# 所有 LinuxDO 用户相关端点已移除
# 商业版使用邮箱 + 兑换码直接上车，无需第三方登录
