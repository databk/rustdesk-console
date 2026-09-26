import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AddressBook, ShareRule } from '../entities';
import { User } from '../../user/entities/user.entity';
import {
  PaginationDto,
  PeersQueryDto,
  AddPeerDto,
  UpdatePeerDto,
  AddTagDto,
  UpdateTagDto,
  RenameTagDto,
} from '../dto';
import { AddressBookPeerService } from './address-book-peer.service';
import { AddressBookTagService } from './address-book-tag.service';
import { AddressBookLegacyService } from './address-book-legacy.service';
import { AddressBookRuleService } from './address-book-rule.service';
import { AddressBookPermissionService } from './address-book-permission.service';

/**
 * Address book service
 * Core service of the address book module, responsible for coordinating the sub-services
 *
 * Features:
 * - Basic address book management (create, get, permission checks)
 * - Device management (delegated to PeerService)
 * - Tag management (delegated to TagService)
 * - Share management (delegated to RuleService)
 * - Legacy API compatibility (delegated to LegacyService)
 *
 * Architecture:
 * Uses a service delegation pattern, delegating specific functionality to dedicated sub-services
 * The main service handles permission checks, coordination, and routing
 */
@Injectable()
export class AddressBookService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly peerService: AddressBookPeerService,
    private readonly tagService: AddressBookTagService,
    private readonly ruleService: AddressBookRuleService,
    private readonly legacyService: AddressBookLegacyService,
    private readonly permissionService: AddressBookPermissionService,
  ) {}

  // ============ Basic address book management ============

  /**
   * Get the address book settings
   * Get the global configuration parameters of the address book
   *
   * @returns Address book settings object
   */
  getSettings() {
    return { max_peer_one_ab: 0 };
  }

  /**
   * Get the personal address book GUID
   * Get or create the user's personal address book
   *
   * @param userId User ID
   * @returns Object containing the address book GUID
   */
  async getPersonalAddressBook(userId: string) {
    let addressBook = await this.addressBookRepository.findOne({
      where: { owner: userId, isPersonal: true },
    });

    if (!addressBook) {
      // If the personal address book does not exist, create it automatically
      addressBook = this.addressBookRepository.create({
        guid: uuidv4(),
        owner: userId,
        name: 'Personal',
        isPersonal: true,
      });
      await this.addressBookRepository.save(addressBook);
    }

    return { guid: addressBook.guid };
  }

  async getCustomAddressBooks(userId: string, query: PaginationDto) {
    return this.ruleService.getCustomAddressBooks(userId, query);
  }

  async addCustomAddressBook(
    name: string,
    userId: string,
    note?: string,
    password?: string,
  ) {
    return this.ruleService.addCustomAddressBook(name, userId, note, password);
  }

  async updateCustomAddressBook(
    guid: string,
    userId: string,
    name?: string,
    note?: string,
  ) {
    return this.ruleService.updateCustomAddressBook(guid, userId, name, note);
  }

  async deleteCustomAddressBooks(guids: string[], userId: string) {
    return this.ruleService.deleteCustomAddressBooks(guids, userId);
  }

  // ============ Device management (delegated to PeerService) ============

  /**
   * Get the device list of the address book
   * Delegated to PeerService, which performs permission verification automatically
   *
   * @param query Query parameters, including pagination and filter conditions
   * @param userId User ID (optional, used for permission verification)
   * @returns Device list and total count
   */
  async getPeers(query: PeersQueryDto, userId?: string) {
    return this.peerService.getPeers(
      query,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * Add a device to the address book
   * Delegated to PeerService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param dto Device information DTO
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async addPeer(addressBookGuid: string, dto: AddPeerDto, userId?: string) {
    return this.peerService.addPeer(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
      (abGuid: string, tagName: string) =>
        this.tagService.getOrCreateTag(abGuid, tagName),
    );
  }

  /**
   * Update device information in the address book
   * Delegated to PeerService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param dto Device update information DTO
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async updatePeer(
    addressBookGuid: string,
    dto: UpdatePeerDto,
    userId?: string,
  ) {
    return this.peerService.updatePeer(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
      (abGuid: string, tagName: string) =>
        this.tagService.getOrCreateTag(abGuid, tagName),
    );
  }

  /**
   * Delete devices from the address book
   * Delegated to PeerService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param ids List of device IDs to delete
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async deletePeers(addressBookGuid: string, ids: string[], userId?: string) {
    return this.peerService.deletePeers(
      addressBookGuid,
      ids,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  // ============ Tag management (delegated to TagService) ============

  /**
   * Get the address book tag list
   * Delegated to TagService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param userId User ID (optional, used for permission verification)
   * @returns Tag list
   */
  async getTags(addressBookGuid: string, userId?: string) {
    return this.tagService.getTags(
      addressBookGuid,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * Add a tag to the address book
   * Delegated to TagService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param dto Tag information DTO
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async addTag(addressBookGuid: string, dto: AddTagDto, userId?: string) {
    return this.tagService.addTag(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * Rename a tag
   * Delegated to TagService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param dto Rename information DTO
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async renameTag(addressBookGuid: string, dto: RenameTagDto, userId?: string) {
    return this.tagService.renameTag(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * Update the tag color
   * Delegated to TagService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param dto Tag update information DTO
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async updateTag(addressBookGuid: string, dto: UpdateTagDto, userId?: string) {
    return this.tagService.updateTag(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * Delete the tags
   * Delegated to TagService, which performs permission verification automatically
   *
   * @param addressBookGuid Address book GUID
   * @param names List of tag names to delete
   * @param userId User ID (optional, used for permission verification)
   * @returns Operation result
   */
  async deleteTags(addressBookGuid: string, names: string[], userId?: string) {
    return this.tagService.deleteTags(
      addressBookGuid,
      names,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  // ============ Share management (delegated to RuleService) ============

  /**
   * Get the list of address books shared with the user
   * Delegated to RuleService
   *
   * @param userId User ID
   * @param query Pagination query parameters
   * @returns Shared address book list
   */
  async getSharedAddressBooks(userId: string, query: PaginationDto) {
    return this.ruleService.getSharedAddressBooks(userId, query);
  }

  async getWebSharedAddressBooks(userId: string, query: PaginationDto) {
    return this.ruleService.getWebSharedAddressBooks(userId, query);
  }

  async getWebSharedAddressBook(guid: string, userId: string) {
    return this.ruleService.getWebSharedAddressBook(guid, userId);
  }

  /**
   * Add a shared address book
   * Delegated to RuleService
   *
   * @param name Address book name
   * @param userId User ID
   * @param note Remarks
   * @param password Password
   * @returns GUID of the newly created address book
   */
  async addSharedAddressBook(
    name: string,
    userId?: string,
    note?: string,
    password?: string,
  ) {
    return this.ruleService.addSharedAddressBook(
      name,
      userId || '',
      note,
      password,
    );
  }

  /**
   * Update a shared address book
   * Delegated to RuleService
   *
   * @param guid Address book GUID
   * @param name New name
   * @param note New note
   * @param owner New owner
   * @param password New password
   * @param userId Current user ID
   */
  async updateSharedAddressBook(
    guid: string,
    name?: string,
    note?: string,
    owner?: string,
    password?: string,
    userId?: string,
  ) {
    return this.ruleService.updateSharedAddressBook(
      guid,
      name,
      note,
      owner,
      password,
      userId,
    );
  }

  /**
   * Delete shared address books
   * Delegated to RuleService
   *
   * @param guids Array of address book GUIDs
   * @param userId User ID
   */
  async deleteSharedAddressBooks(guids: string[], userId: string) {
    return this.ruleService.deleteSharedAddressBooks(guids, userId);
  }

  // ============ Legacy API (delegated to LegacyService) ============

  /**
   * Get legacy address book data
   * Delegated to LegacyService, for compatibility with older clients
   *
   * @param userId User ID
   * @returns Legacy address book data
   */
  async getLegacyAddressBook(userId: string) {
    return this.legacyService.getLegacyAddressBook(userId);
  }

  /**
   * Update legacy address book data
   * Delegated to LegacyService, for compatibility with older clients
   *
   * @param userId User ID
   * @param data Address book data string
   * @returns Operation result
   */
  async updateLegacyAddressBook(userId: string, data: string) {
    return this.legacyService.updateLegacyAddressBook(userId, data);
  }
}
