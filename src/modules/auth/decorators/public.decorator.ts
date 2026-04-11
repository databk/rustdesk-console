import { SetMetadata } from '@nestjs/common';

/**
 * Public 装饰器
 * 标记路由为公开，无需JWT认证即可访问
 *
 * 使用场景：
 * 用于认证模块中不需要认证的路由
 *
 * @param field 需要提取的用户字段名（可选）
 * @returns 装饰器函数
 *
 * @example
 * @Public() @Post('login')
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
