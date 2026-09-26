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
  CreateAddressBookProfileDto,
  UpdateAddressBookProfileDto,
  UpdateCustomAddressBookProfileDto,
  DeleteAddressBooksDto,
} from './dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AddressBookRuleService } from './services/address-book-rule.service';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';

/**
 * Address book controller
 * Handles address book related HTTP requests, including address book management, device management, tag management, and rule management
 *
 * Number of endpoints: 26
 *
 * Legacy API (compatibility):
 * - GET /api/ab - Get the legacy address book
 * - POST /api/ab - Update the legacy address book
 *
 * New API:
 * - POST /api/ab/settings - Get the address book settings
 * - GET /api/ab/personal - Get the personal address book GUID
 * - POST /api/ab/personal - Get the personal address book GUID
 * - GET /api/ab/shared/profiles - Get the shared address book list
 * - POST /api/ab/shared/profiles - Get the shared address book list
 * - POST /api/ab/shared/add - Add a shared address book
 * - PUT /api/ab/shared/update/profile - Update a shared address book
 * - DELETE /api/ab/shared - Delete shared address books
 * - GET /api/ab/peers - Get the device list of an address book
 * - POST /api/ab/peers - Get the device list of an address book
 * - GET /api/ab/tags/{guid} - Get the address book tag list
 * - POST /api/ab/tags/{guid} - Get the address book tag list
 * - POST /api/ab/peer/add/{guid} - Add a device to the address book
 * - PUT /api/ab/peer/update/{guid} - Update device information
 * - DELETE /api/ab/peer/{guid} - Delete a device
 * - POST /api/ab/tag/add/{guid} - Add a tag
 * - PUT /api/ab/tag/rename/{guid} - Rename a tag
 * - PUT /api/ab/tag/update/{guid} - Update a tag color
 * - DELETE /api/ab/tag/{guid} - Delete a tag
 * - GET /api/ab/rules - Get the address book rule list
 * - POST /api/ab/rule - Add a rule
 * - PATCH /api/ab/rule - Update a rule
 * - DELETE /api/ab/rules - Delete rules
 */
@Controller('ab')
export class AddressBookController {
  constructor(
    private readonly addressBookService: AddressBookService,
    private readonly ruleService: AddressBookRuleService,
  ) {}

  // ============ Legacy API ============

  /**
   * Get the legacy address book
   * Get the user's legacy address book data (compatibility endpoint)
   *
   * @param userId Current user ID (extracted from the JWT token)
   * @returns JSON string of the legacy address book
   */
  @Get()
  async getLegacyAddressBook(@CurrentUser('id') userId: number) {
    return this.addressBookService.getLegacyAddressBook(String(userId));
  }

  /**
   * Update the legacy address book
   * Update the user's legacy address book data (compatibility endpoint)
   *
   * @param data JSON string of the address book data
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns the address book data on successful update, or an error message on failure
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

  // ============ New API ============

  /**
   * Get the address book settings
   * Get the global settings of the address book
   *
   * @returns Address book settings object
   */
  @Post('settings')
  @HttpCode(HttpStatus.OK)
  getSettings() {
    return this.addressBookService.getSettings();
  }

  /**
   * Get the personal address book GUID
   * Get the unique identifier of the current user's personal address book
   *
   * @param userId Current user ID (extracted from the JWT token)
   * @returns GUID of the personal address book
   */
  @Get('personal')
  @HttpCode(HttpStatus.OK)
  getPersonalAddressBookGet(@CurrentUser('id') userId: number) {
    return this.addressBookService.getPersonalAddressBook(String(userId));
  }

  /**
   * Get the personal address book GUID
   * Get the unique identifier of the current user's personal address book
   *
   * @param userId Current user ID (extracted from the JWT token)
   * @returns GUID of the personal address book
   */
  @Post('personal')
  @HttpCode(HttpStatus.OK)
  getPersonalAddressBook(@CurrentUser('id') userId: number) {
    return this.addressBookService.getPersonalAddressBook(String(userId));
  }

  @Get('custom/profiles')
  @HttpCode(HttpStatus.OK)
  getCustomAddressBooks(
    @Query() query: PaginationDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getCustomAddressBooks(String(userId), query);
  }

  @Post('custom/add')
  @HttpCode(HttpStatus.OK)
  async addCustomAddressBook(
    @Body() dto: CreateAddressBookProfileDto,
    @CurrentUser('id') userId: number,
  ) {
    const guid = await this.addressBookService.addCustomAddressBook(
      dto.name,
      String(userId),
      dto.note,
      dto.password ?? dto.info?.password,
    );
    return { guid };
  }

  @Put('custom/update/profile')
  @HttpCode(HttpStatus.OK)
  async updateCustomAddressBook(
    @Body() dto: UpdateCustomAddressBookProfileDto,
    @CurrentUser('id') userId: number,
  ) {
    await this.addressBookService.updateCustomAddressBook(
      dto.guid,
      String(userId),
      dto.name,
      dto.note,
    );
    return { message: 'Updated successfully' };
  }

  @Delete('custom')
  @HttpCode(HttpStatus.OK)
  async deleteCustomAddressBooks(
    @Body() dto: DeleteAddressBooksDto,
    @CurrentUser('id') userId: number,
  ) {
    await this.addressBookService.deleteCustomAddressBooks(
      dto.guids,
      String(userId),
    );
    return { message: 'Deleted successfully' };
  }

  /**
   * Get the shared address book list
   * Get all shared address books accessible to the current user
   *
   * @param query Pagination query parameters
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Shared address book list (paginated)
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
   * Get the shared address book list
   * Get all shared address books accessible to the current user
   *
   * @param query Pagination query parameters
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Shared address book list (paginated)
   */
  @Post('shared/profiles')
  @HttpCode(HttpStatus.OK)
  getSharedAddressBooks(
    @Query() query: PaginationDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getSharedAddressBooks(String(userId), query);
  }

  @Get('shared/list')
  @HttpCode(HttpStatus.OK)
  getWebSharedAddressBooks(
    @Query() query: PaginationDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getWebSharedAddressBooks(
      String(userId),
      query,
    );
  }

  @Get('shared/:guid/access')
  @HttpCode(HttpStatus.OK)
  getWebSharedAddressBook(
    @Param('guid') guid: string,
    @CurrentUser('id') userId: number,
  ) {
    return this.addressBookService.getWebSharedAddressBook(
      guid,
      String(userId),
    );
  }

  @Get('shared/:guid/share-candidates')
  @RequirePermission('address_books.share')
  @HttpCode(HttpStatus.OK)
  getShareCandidates(
    @Param('guid') guid: string,
    @CurrentUser('id') userId: number,
  ) {
    return this.ruleService.getShareCandidates(guid, String(userId));
  }

  /**
   * Add a shared address book
   * Create a new shared address book
   *
   * @param dto Address book information data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Operation result
   */
  @Post('shared/add')
  @RequirePermission('address_books.share')
  @HttpCode(HttpStatus.OK)
  async addSharedAddressBook(
    @Body() dto: CreateAddressBookProfileDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      const guid = await this.addressBookService.addSharedAddressBook(
        dto.name,
        String(userId),
        dto.note,
        dto.password ?? dto.info?.password,
      );
      return { guid };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update a shared address book
   * Update the information of an existing shared address book
   *
   * @param dto Address book update data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Operation result
   */
  @Put('shared/update/profile')
  @RequirePermission('address_books.edit')
  @HttpCode(HttpStatus.OK)
  async updateSharedAddressBook(
    @Body() dto: UpdateAddressBookProfileDto,
    @CurrentUser('id') userId: number,
  ) {
    try {
      await this.addressBookService.updateSharedAddressBook(
        dto.guid,
        dto.name,
        dto.note,
        dto.owner,
        dto.password ?? dto.info?.password,
        String(userId),
      );
      return '';
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Delete shared address books
   * Delete one or more shared address books
   *
   * @param guids Array of address book GUIDs to delete
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Operation result
   */
  @Delete('shared')
  @RequirePermission('address_books.edit')
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
   * Get the device list of the address book
   * Get all device information in the specified address book
   *
   * @param query Query parameters (including tags, search keywords, etc.)
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Device list
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
   * Get the device list of the address book
   * Get all device information in the specified address book
   *
   * @param query Query parameters (including tags, search keywords, etc.)
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Device list
   */
  @Post('peers')
  @HttpCode(HttpStatus.OK)
  getPeers(@Query() query: PeersQueryDto, @CurrentUser('id') userId: number) {
    return this.addressBookService.getPeers(query, String(userId));
  }

  /**
   * Get the address book tag list
   * Get all tags in the specified address book
   *
   * @param guid Address book GUID
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Tag list
   */
  @Get('tags/:guid')
  @HttpCode(HttpStatus.OK)
  getTagsGet(@Param('guid') guid: string, @CurrentUser('id') userId: number) {
    return this.addressBookService.getTags(guid, String(userId));
  }

  /**
   * Get the address book tag list
   * Get all tags in the specified address book
   *
   * @param guid Address book GUID
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Tag list
   */
  @Post('tags/:guid')
  @HttpCode(HttpStatus.OK)
  getTags(@Param('guid') guid: string, @CurrentUser('id') userId: number) {
    return this.addressBookService.getTags(guid, String(userId));
  }

  /**
   * Add a device to the address book
   * Add a new device to the specified address book
   *
   * @param guid Address book GUID
   * @param dto Device information data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful addition, or an error message on failure
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
   * Update device information
   * Update device information in the specified address book
   *
   * @param guid Address book GUID
   * @param dto Device update information data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful update, or an error message on failure
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
   * Delete devices
   * Delete one or more devices from the specified address book
   *
   * @param guid Address book GUID
   * @param ids Array of device IDs to delete
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful deletion, or an error message on failure
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
   * Add a tag
   * Add a new tag to the specified address book
   *
   * @param guid Address book GUID
   * @param dto Tag information data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful addition, or an error message on failure
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
   * Rename a tag
   * Rename a tag in the specified address book
   *
   * @param guid Address book GUID
   * @param dto Tag rename data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful rename, or an error message on failure
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
   * Update the tag color
   * Update the color of a tag in the specified address book
   *
   * @param guid Address book GUID
   * @param dto Tag color update data transfer object
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful update, or an error message on failure
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
   * Delete the tags
   * Delete one or more tags from the specified address book
   *
   * @param guid Address book GUID
   * @param names Array of tag names to delete
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Returns an empty string on successful deletion, or an error message on failure
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

  // ============ Rule management API ============

  /**
   * Get the address book rule list
   * Query all access rules of the specified address book (paginated)
   *
   * @param query Query parameters (including the address book GUID and pagination info)
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Rule list (paginated)
   */
  @Get('rules')
  @RequirePermission('address_books.view')
  @HttpCode(HttpStatus.OK)
  async getRules(
    @Query() query: RuleQueryDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.ruleService.getRules(query, String(userId));
  }

  /**
   * Add an address book rule
   * Creates a new access rule for the specified address book
   *
   * @param dto Rule creation data
   * @param userId Current user ID (extracted from the JWT token)
   * @returns GUID of the newly created rule
   */
  @Post('rule')
  @RequirePermission('address_books.share')
  @HttpCode(HttpStatus.OK)
  async addRule(@Body() dto: CreateRuleDto, @CurrentUser('id') userId: number) {
    return this.ruleService.createRule(dto, String(userId));
  }

  /**
   * Update an address book rule
   * Modify the permission level of the specified rule
   *
   * @param dto Rule update data
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Update success message
   */
  @Patch('rule')
  @RequirePermission('address_books.share')
  @HttpCode(HttpStatus.OK)
  async updateRule(
    @Body() dto: UpdateRuleDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.ruleService.updateRule(dto, String(userId));
  }

  /**
   * Delete address book rules
   * Batch delete one or more rules
   *
   * @param ruleGuids Array of rule GUIDs to delete
   * @param userId Current user ID (extracted from the JWT token)
   * @returns Deletion success message
   */
  @Delete('rules')
  @RequirePermission('address_books.share')
  @HttpCode(HttpStatus.OK)
  async deleteRules(
    @Body() ruleGuids: string[],
    @CurrentUser('id') userId: number,
  ) {
    return this.ruleService.deleteRules(ruleGuids, String(userId));
  }
}
