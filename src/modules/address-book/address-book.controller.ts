import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AddressBookService } from './services';
import {
  AddPeerDto,
  UpdatePeerDto,
  AddTagDto,
  UpdateTagDto,
  RenameTagDto,
  PaginationDto,
  PeersQueryDto,
  RuleQueryDto,
  CreateRuleDto,
  UpdateRuleDto,
} from './dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AddressBookRuleService } from './services/address-book-rule.service';

/**
 * 地址簿控制器
 * 负责处理地址簿相关的 HTTP 请求，包括地址簿管理、设备管理、标签管理和规则管理
 *
 * 端点数量：26 个
 *
 * 旧版 API（兼容性）：
 * - GET /api/ab - 获取旧版地址簿
 * - POST /api/ab - 更新旧版地址簿
 *
 * 新版 API：
 * - POST /api/ab/settings - 获取地址簿设置
 * - GET /api/ab/personal - 获取个人地址簿 GUID
 * - POST /api/ab/personal - 获取个人地址簿 GUID
 * - GET /api/ab/shared/profiles - 获取共享地址簿列表
 * - POST /api/ab/shared/profiles - 获取共享地址簿列表
 * - POST /api/ab/shared/add - 添加共享地址簿
 * - PUT /api/ab/shared/update/profile - 更新共享地址簿
 * - DELETE /api/ab/shared - 删除共享地址簿
 * - GET /api/ab/peers - 获取地址簿中的设备列表
 * - POST /api/ab/peers - 获取地址簿中的设备列表
 * - GET /api/ab/tags/{guid} - 获取地址簿标签列表
 * - POST /api/ab/tags/{guid} - 获取地址簿标签列表
 * - POST /api/ab/peer/add/{guid} - 添加设备到地址簿
 * - PUT /api/ab/peer/update/{guid} - 更新设备信息
 * - DELETE /api/ab/peer/{guid} - 删除设备
 * - POST /api/ab/tag/add/{guid} - 添加标签
 * - PUT /api/ab/tag/rename/{guid} - 重命名标签
 * - PUT /api/ab/tag/update/{guid} - 更新标签颜色
 * - DELETE /api/ab/tag/{guid} - 删除标签
 * - GET /api/ab/rules - 获取地址簿规则列表
 * - POST /api/ab/rule - 添加规则
 * - PATCH /api/ab/rule - 更新规则
 * - DELETE /api/ab/rules - 删除规则
 */
@Controller('ab')
export class AddressBookController {
  constructor(
    private readonly addressBookService: AddressBookService,
    private readonly ruleService: AddressBookRuleService,
  ) {}

  // ============ 旧版（Legacy）API ============

  /**
   * 获取旧版地址簿
   * 获取用户的旧版地址簿数据（兼容性接口）
   *
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 旧版地址簿的 JSON 字符串
   */
  @Get()
  async getLegacyAddressBook(@CurrentUser('id') userId: number) {
    return this.addressBookService.getLegacyAddressBook(String(userId));
  }

  /**
   * 更新旧版地址簿
   * 更新用户的旧版地址簿数据（兼容性接口）
   *
   * @param data 地址簿数据的 JSON 字符串
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 更新成功返回地址簿数据，失败返回错误信息
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async updateLegacyAddressBook(
    @Body('data') data: string,
    @CurrentUser('id') userId: number,
  ) {
    try {
      return await this.addressBookService.updateLegacyAddressBook(
        String(userId),
        data,
      );
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ============ 新版 API ============

  /**
   * 获取地址簿设置
   * 获取地址簿的全局设置信息
   *
   * @returns 地址簿设置对象
   */
  @Post('settings')
  @HttpCode(HttpStatus.OK)
  getSettings() {
    return this.addressBookService.getSettings();
  }

  /**
   * 获取个人地址簿 GUID
   * 获取当前用户的个人地址簿的唯一标识符
   *
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 个人地址簿的 GUID
   */
  @Get('personal')
  @HttpCode(HttpStatus.OK)
  getPersonalAddressBookGet(@CurrentUser('id') userId: number) {
    return this.addressBookService.getPersonalAddressBook(String(userId));
  }

  /**
   * 获取个人地址簿 GUID
   * 获取当前用户的个人地址簿的唯一标识符
   *
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 个人地址簿的 GUID
   */
  @Post('personal')
  @HttpCode(HttpStatus.OK)
  getPersonalAddressBook(@CurrentUser('id') userId: number) {
    return this.addressBookService.getPersonalAddressBook(String(userId));
  }

  /**
   * 获取共享地址簿列表
   * 获取当前用户可访问的所有共享地址簿列表
   *
   * @param query 分页查询参数
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 共享地址簿列表（分页）
   */
  @Get('shared/profiles')
  @HttpCode(HttpStatus.OK)
  getSharedAddressBooksGet(
    @Query() query: PaginationDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getSharedAddressBooks(String(userId), query);
  }

  /**
   * 获取共享地址簿列表
   * 获取当前用户可访问的所有共享地址簿列表
   *
   * @param query 分页查询参数
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 共享地址簿列表（分页）
   */
  @Post('shared/profiles')
  @HttpCode(HttpStatus.OK)
  getSharedAddressBooks(
    @Query() query: PaginationDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getSharedAddressBooks(String(userId), query);
  }

  /**
   * 添加共享地址簿
   * 创建一个新的共享地址簿
   *
   * @param dto 地址簿信息数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 操作结果
   */
  @Post('shared/add')
  @HttpCode(HttpStatus.OK)
  async addSharedAddressBook(
    @Body() dto: { name: string; note?: string; password?: string },
    @CurrentUser('id') userId: number,
  ) {
    try {
      const guid = await this.addressBookService.addSharedAddressBook(
        dto.name,
        String(userId),
        dto.note,
        dto.password,
      );
      return { guid };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 更新共享地址簿
   * 更新现有共享地址簿的信息
   *
   * @param dto 地址簿更新数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 操作结果
   */
  @Put('shared/update/profile')
  @HttpCode(HttpStatus.OK)
  async updateSharedAddressBook(
    @Body()
    dto: {
      guid: string;
      name?: string;
      note?: string;
      owner?: string;
      password?: string;
    },
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.updateSharedAddressBook(
        dto.guid,
        dto.name,
        dto.note,
        dto.owner,
        dto.password,
        String(userId),
      );
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 删除共享地址簿
   * 删除一个或多个共享地址簿
   *
   * @param guids 要删除的地址簿 GUID 数组
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 操作结果
   */
  @Delete('shared')
  @HttpCode(HttpStatus.OK)
  async deleteSharedAddressBooks(
    @Body() guids: string[],
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.deleteSharedAddressBooks(
        guids,
        String(userId),
      );
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 获取地址簿中的设备列表
   * 获取指定地址簿中的所有设备信息
   *
   * @param query 查询参数（包含标签、搜索关键词等）
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 设备列表
   */
  @Get('peers')
  @HttpCode(HttpStatus.OK)
  getPeersGet(
    @Query() query: PeersQueryDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getPeers(query, String(userId));
  }

  /**
   * 获取地址簿中的设备列表
   * 获取指定地址簿中的所有设备信息
   *
   * @param query 查询参数（包含标签、搜索关键词等）
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 设备列表
   */
  @Post('peers')
  @HttpCode(HttpStatus.OK)
  getPeers(@Query() query: PeersQueryDto, @CurrentUser('id') userId: number) {
    return this.addressBookService.getPeers(query, String(userId));
  }

  /**
   * 获取地址簿标签列表
   * 获取指定地址簿中的所有标签
   *
   * @param guid 地址簿 GUID
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 标签列表
   */
  @Get('tags/:guid')
  @HttpCode(HttpStatus.OK)
  getTagsGet(@Param('guid') guid: string, @CurrentUser('id') userId: number) {
    return this.addressBookService.getTags(guid, String(userId));
  }

  /**
   * 获取地址簿标签列表
   * 获取指定地址簿中的所有标签
   *
   * @param guid 地址簿 GUID
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 标签列表
   */
  @Post('tags/:guid')
  @HttpCode(HttpStatus.OK)
  getTags(@Param('guid') guid: string, @CurrentUser('id') userId: number) {
    return this.addressBookService.getTags(guid, String(userId));
  }

  /**
   * 添加设备到地址簿
   * 向指定地址簿添加新的设备
   *
   * @param guid 地址簿 GUID
   * @param dto 设备信息数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 添加成功返回空字符串，失败返回错误信息
   */
  @Post('peer/add/:guid')
  @HttpCode(HttpStatus.OK)
  async addPeer(
    @Param('guid') guid: string,
    @Body() dto: AddPeerDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.addPeer(guid, dto, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 更新设备信息
   * 更新指定地址簿中的设备信息
   *
   * @param guid 地址簿 GUID
   * @param dto 设备更新信息数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 更新成功返回空字符串，失败返回错误信息
   */
  @Put('peer/update/:guid')
  @HttpCode(HttpStatus.OK)
  async updatePeer(
    @Param('guid') guid: string,
    @Body() dto: UpdatePeerDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.updatePeer(guid, dto, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 删除设备
   * 从指定地址簿中删除一个或多个设备
   *
   * @param guid 地址簿 GUID
   * @param ids 要删除的设备 ID 数组
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 删除成功返回空字符串，失败返回错误信息
   */
  @Delete('peer/:guid')
  @HttpCode(HttpStatus.OK)
  async deletePeers(
    @Param('guid') guid: string,
    @Body() ids: string[],
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.deletePeers(guid, ids, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 添加标签
   * 向指定地址簿添加新的标签
   *
   * @param guid 地址簿 GUID
   * @param dto 标签信息数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 添加成功返回空字符串，失败返回错误信息
   */
  @Post('tag/add/:guid')
  @HttpCode(HttpStatus.OK)
  async addTag(
    @Param('guid') guid: string,
    @Body() dto: AddTagDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.addTag(guid, dto, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 重命名标签
   * 重命名指定地址簿中的标签
   *
   * @param guid 地址簿 GUID
   * @param dto 标签重命名数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 重命名成功返回空字符串，失败返回错误信息
   */
  @Put('tag/rename/:guid')
  @HttpCode(HttpStatus.OK)
  async renameTag(
    @Param('guid') guid: string,
    @Body() dto: RenameTagDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.renameTag(guid, dto, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 更新标签颜色
   * 更新指定地址簿中标签的颜色
   *
   * @param guid 地址簿 GUID
   * @param dto 标签颜色更新数据传输对象
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 更新成功返回空字符串，失败返回错误信息
   */
  @Put('tag/update/:guid')
  @HttpCode(HttpStatus.OK)
  async updateTag(
    @Param('guid') guid: string,
    @Body() dto: UpdateTagDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.updateTag(guid, dto, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 删除标签
   * 从指定地址簿中删除一个或多个标签
   *
   * @param guid 地址簿 GUID
   * @param names 要删除的标签名称数组
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 删除成功返回空字符串，失败返回错误信息
   */
  @Delete('tag/:guid')
  @HttpCode(HttpStatus.OK)
  async deleteTags(
    @Param('guid') guid: string,
    @Body() names: string[],
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.deleteTags(guid, names, String(userId));
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ============ 规则管理 API ============

  /**
   * 获取地址簿规则列表
   * 分页查询指定地址簿的所有访问规则
   *
   * @param query 查询参数（包含地址簿 GUID 和分页信息）
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 规则列表（分页）
   */
  @Get('rules')
  @HttpCode(HttpStatus.OK)
  async getRules(
    @Query() query: RuleQueryDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.ruleService.getRules(query, String(userId));
  }

  /**
   * 添加地址簿规则
   * 为指定地址簿创建新的访问规则
   *
   * @param dto 创建规则数据
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 新创建的规则 GUID
   */
  @Post('rule')
  @HttpCode(HttpStatus.OK)
  async addRule(@Body() dto: CreateRuleDto, @CurrentUser('id') userId: number) {
    try {
      return await this.ruleService.createRule(dto, String(userId));
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 更新地址簿规则
   * 修改指定规则的权限级别
   *
   * @param dto 更新规则数据
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 更新成功消息
   */
  @Patch('rule')
  @HttpCode(HttpStatus.OK)
  async updateRule(
    @Body() dto: UpdateRuleDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      return await this.ruleService.updateRule(dto, String(userId));
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 删除地址簿规则
   * 批量删除一个或多个规则
   *
   * @param ruleGuids 要删除的规则 GUID 数组
   * @param userId 当前用户 ID（从 JWT 令牌中提取）
   * @returns 删除成功消息
   */
  @Delete('rules')
  @HttpCode(HttpStatus.OK)
  async deleteRules(
    @Body() ruleGuids: string[],
    @CurrentUser('id') userId: number,
  ) {
    try {
      return await this.ruleService.deleteRules(ruleGuids, String(userId));
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}
