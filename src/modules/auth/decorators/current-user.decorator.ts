import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser 装饰器
 * 从JWT令牌中提取当前用户信息并注入到控制器方法参数中
 *
 * 使用场景：
 * 在认证模块的控制器方法参数中使用
 *
 * @param field 需要提取的用户字段名（可选）
 * @returns 装饰器函数
 *
 * @example
 * async method(@CurrentUser('id') userId: string)
 */
export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
