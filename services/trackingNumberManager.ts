/**
 * Tracking Number State Manager
 * Resolves tracking number reuse issues through proper lifecycle management
 * Implements idempotent creation and soft delete patterns
 */

import { UserRole } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type TrackingNumberStatus = 'ACTIVE' | 'EXPIRED' | 'ARCHIVED' | 'REVOKED';

export interface TrackingNumberRecord {
  id: string;
  trackingNumber: string;
  shipmentId: string;
  role: UserRole;
  recipientStopId?: string;
  status: TrackingNumberStatus;
  createdAt: Date;
  expiresAt?: Date;
  archivedAt?: Date;
  revokedAt?: Date;
  revokedReason?: string;
}

export interface CreateTrackingNumberOptions {
  shipmentId: string;
  role: UserRole;
  recipientStopId?: string;
  expirationDays?: number; // Default: 30 days for RECIPIENT, never for MANAGER/SUPPLIER
  idempotencyKey?: string; // Prevents duplicate creation
}

export interface TrackingNumberQuery {
  trackingNumber?: string;
  shipmentId?: string;
  role?: UserRole;
  status?: TrackingNumberStatus;
  includeArchived?: boolean;
}

// ============================================================================
// TRACKING NUMBER STATE MANAGER
// ============================================================================

class TrackingNumberManager {
  private cache: Map<string, TrackingNumberRecord> = new Map();
  private idempotencyKeys: Map<string, string> = new Map(); // idempotencyKey -> trackingNumber

  // ============================================================================
  // CORE LIFECYCLE METHODS
  // ============================================================================

  /**
   * Create or retrieve existing tracking number (idempotent)
   * 
   * Key design principle: If called with same idempotencyKey, returns existing tracking number
   * This solves the "cannot reuse tracking number after restart" problem
   */
  async createTrackingNumber(options: CreateTrackingNumberOptions): Promise<TrackingNumberRecord> {
    const { shipmentId, role, recipientStopId, expirationDays, idempotencyKey } = options;

    // 1. Check idempotency - if this request was already made, return existing
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        console.log(`♻️ Reusing tracking number from idempotency key: ${existing.trackingNumber}`);
        return existing;
      }
    }

    // 2. Generate tracking number
    const trackingNumber = this.generateTrackingNumber(role, shipmentId);

    // 3. Check if tracking number already exists (and is active)
    const existingRecord = await this.findByTrackingNumber(trackingNumber);
    
    if (existingRecord && existingRecord.status === 'ACTIVE') {
      // If active, this is a duplicate creation attempt
      console.warn(`⚠️ Tracking number ${trackingNumber} already exists and is active`);
      return existingRecord;
    }

    if (existingRecord && existingRecord.status === 'ARCHIVED') {
      // If archived, we can reactivate it (soft delete pattern)
      console.log(`🔄 Reactivating archived tracking number: ${trackingNumber}`);
      return await this.reactivateTrackingNumber(trackingNumber);
    }

    // 4. Create new record
    const expiresAt = this.calculateExpirationDate(role, expirationDays);

    const record: TrackingNumberRecord = {
      id: this.generateUUID(),
      trackingNumber,
      shipmentId,
      role,
      recipientStopId,
      status: 'ACTIVE',
      createdAt: new Date(),
      expiresAt,
    };

    // 5. Persist to database
    await this.persistTrackingNumber(record);

    // 6. Cache the record
    this.cache.set(trackingNumber, record);

    // 7. Store idempotency key if provided
    if (idempotencyKey) {
      this.idempotencyKeys.set(idempotencyKey, trackingNumber);
    }

    console.log(`✅ Created tracking number: ${trackingNumber} (${role})`);
    return record;
  }

  /**
   * Find tracking number by ID or tracking number string
   */
  async findByTrackingNumber(trackingNumber: string): Promise<TrackingNumberRecord | null> {
    // 1. Check cache first
    if (this.cache.has(trackingNumber)) {
      return this.cache.get(trackingNumber)!;
    }

    // 2. Query database
    const records = await this.queryDatabase({ trackingNumber });

    // 3. Update cache
    const record = records[0] || null;
    if (record) {
      this.cache.set(trackingNumber, record);
    }

    return record;
  }

  /**
   * Find by idempotency key (prevents duplicate creation)
   */
  private async findByIdempotencyKey(idempotencyKey: string): Promise<TrackingNumberRecord | null> {
    // 1. Check in-memory map
    const trackingNumber = this.idempotencyKeys.get(idempotencyKey);
    if (trackingNumber) {
      return await this.findByTrackingNumber(trackingNumber);
    }

    // 2. Query database (in case of restart)
    // TODO: Add idempotency_key column to tracking_numbers table
    // SELECT * FROM tracking_numbers WHERE idempotency_key = $1

    return null;
  }

  /**
   * Soft delete (archive) a tracking number
   * 
   * This is the key to fixing the reuse problem:
   * Instead of hard delete, we mark as ARCHIVED
   * Archived numbers can be reactivated later
   */
  async archiveTrackingNumber(trackingNumber: string, reason?: string): Promise<void> {
    const record = await this.findByTrackingNumber(trackingNumber);

    if (!record) {
      throw new Error(`Tracking number not found: ${trackingNumber}`);
    }

    if (record.status === 'ARCHIVED') {
      console.log(`ℹ️ Tracking number already archived: ${trackingNumber}`);
      return;
    }

    // Update status
    record.status = 'ARCHIVED';
    record.archivedAt = new Date();

    // Persist to database
    await this.updateTrackingNumberStatus(trackingNumber, 'ARCHIVED', { archivedAt: record.archivedAt });

    // Update cache
    this.cache.set(trackingNumber, record);

    console.log(`📦 Archived tracking number: ${trackingNumber}`);
  }

  /**
   * Reactivate an archived tracking number
   */
  async reactivateTrackingNumber(trackingNumber: string): Promise<TrackingNumberRecord> {
    const record = await this.findByTrackingNumber(trackingNumber);

    if (!record) {
      throw new Error(`Tracking number not found: ${trackingNumber}`);
    }

    if (record.status !== 'ARCHIVED') {
      throw new Error(`Can only reactivate ARCHIVED tracking numbers. Current status: ${record.status}`);
    }

    // Update status
    record.status = 'ACTIVE';
    record.archivedAt = undefined;

    // Extend expiration if needed
    if (record.expiresAt && record.expiresAt < new Date()) {
      record.expiresAt = this.calculateExpirationDate(record.role);
    }

    // Persist to database
    await this.updateTrackingNumberStatus(trackingNumber, 'ACTIVE', { 
      archivedAt: null,
      expiresAt: record.expiresAt,
    });

    // Update cache
    this.cache.set(trackingNumber, record);

    console.log(`🔄 Reactivated tracking number: ${trackingNumber}`);
    return record;
  }

  /**
   * Revoke a tracking number (cannot be reactivated)
   */
  async revokeTrackingNumber(trackingNumber: string, reason: string): Promise<void> {
    const record = await this.findByTrackingNumber(trackingNumber);

    if (!record) {
      throw new Error(`Tracking number not found: ${trackingNumber}`);
    }

    if (record.status === 'REVOKED') {
      console.log(`ℹ️ Tracking number already revoked: ${trackingNumber}`);
      return;
    }

    // Update status
    record.status = 'REVOKED';
    record.revokedAt = new Date();
    record.revokedReason = reason;

    // Persist to database
    await this.updateTrackingNumberStatus(trackingNumber, 'REVOKED', {
      revokedAt: record.revokedAt,
      revokedReason: reason,
    });

    // Update cache
    this.cache.set(trackingNumber, record);

    console.log(`🚫 Revoked tracking number: ${trackingNumber} - Reason: ${reason}`);
  }

  /**
   * Check if tracking number is valid and active
   */
  async isValid(trackingNumber: string): Promise<boolean> {
    const record = await this.findByTrackingNumber(trackingNumber);

    if (!record) {
      return false;
    }

    // Check status
    if (record.status !== 'ACTIVE') {
      return false;
    }

    // Check expiration
    if (record.expiresAt && record.expiresAt < new Date()) {
      // Auto-expire
      await this.archiveTrackingNumber(trackingNumber, 'Expired');
      return false;
    }

    return true;
  }

  /**
   * Get all tracking numbers for a shipment
   */
  async getTrackingNumbersForShipment(
    shipmentId: string,
    includeArchived = false
  ): Promise<TrackingNumberRecord[]> {
    return await this.queryDatabase({
      shipmentId,
      includeArchived,
    });
  }

  /**
   * Get tracking number by role for a shipment
   */
  async getTrackingNumberByRole(
    shipmentId: string,
    role: UserRole,
    recipientStopId?: string
  ): Promise<TrackingNumberRecord | null> {
    const records = await this.queryDatabase({
      shipmentId,
      role,
      status: 'ACTIVE',
    });

    if (role === 'RECIPIENT' && recipientStopId) {
      // Find specific recipient tracking number
      return records.find(r => r.recipientStopId === recipientStopId) || null;
    }

    return records[0] || null;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Generate tracking number based on role
   */
  private generateTrackingNumber(role: UserRole, shipmentId: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    const prefix = {
      [UserRole.SUPPLIER]: 'SUPP',
      [UserRole.RECIPIENT]: 'RECV',
      [UserRole.MANAGER]: 'MGR',
    }[role];

    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Calculate expiration date based on role
   */
  private calculateExpirationDate(role: UserRole, expirationDays?: number): Date | undefined {
    if (role === UserRole.MANAGER || role === UserRole.SUPPLIER) {
      // Manager and supplier tracking numbers don't expire
      return undefined;
    }

    // Recipient tracking numbers expire after delivery
    const days = expirationDays || 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    return expiresAt;
  }

  /**
   * Generate UUID (mock implementation)
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Query database for tracking numbers
   */
  private async queryDatabase(query: TrackingNumberQuery): Promise<TrackingNumberRecord[]> {
    // TODO: Replace with actual database query
    
    // Example PostgreSQL query:
    // SELECT * FROM tracking_numbers
    // WHERE 
    //   ($1::text IS NULL OR tracking_number = $1) AND
    //   ($2::uuid IS NULL OR shipment_id = $2) AND
    //   ($3::text IS NULL OR role = $3) AND
    //   ($4::text IS NULL OR status = $4) AND
    //   ($5::boolean = true OR status != 'ARCHIVED')
    // ORDER BY created_at DESC

    console.log('🔍 Database query:', query);

    // Mock implementation - return empty for now
    return [];
  }

  /**
   * Persist tracking number to database
   */
  private async persistTrackingNumber(record: TrackingNumberRecord): Promise<void> {
    // TODO: Replace with actual database insert
    
    // Example PostgreSQL query:
    // INSERT INTO tracking_numbers (
    //   id, tracking_number, shipment_id, role, recipient_stop_id,
    //   status, created_at, expires_at
    // ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)

    console.log('💾 Persisting tracking number:', record.trackingNumber);
  }

  /**
   * Update tracking number status in database
   */
  private async updateTrackingNumberStatus(
    trackingNumber: string,
    status: TrackingNumberStatus,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    // TODO: Replace with actual database update
    
    // Example PostgreSQL query:
    // UPDATE tracking_numbers
    // SET status = $1, archived_at = $2, revoked_at = $3, revoked_reason = $4
    // WHERE tracking_number = $5

    console.log(`📝 Updating tracking number ${trackingNumber} to ${status}`, additionalFields);
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Create tracking numbers for all recipients in a shipment
   */
  async createRecipientTrackingNumbers(
    shipmentId: string,
    recipientStopIds: string[]
  ): Promise<TrackingNumberRecord[]> {
    const records: TrackingNumberRecord[] = [];

    for (const stopId of recipientStopIds) {
      const record = await this.createTrackingNumber({
        shipmentId,
        role: UserRole.RECIPIENT,
        recipientStopId: stopId,
        idempotencyKey: `${shipmentId}-${stopId}`, // Ensures idempotency
      });

      records.push(record);
    }

    return records;
  }

  /**
   * Archive all tracking numbers for a shipment (when delivered)
   */
  async archiveShipmentTrackingNumbers(shipmentId: string): Promise<void> {
    const records = await this.getTrackingNumbersForShipment(shipmentId, false);

    for (const record of records) {
      if (record.status === 'ACTIVE') {
        await this.archiveTrackingNumber(record.trackingNumber, 'Shipment delivered');
      }
    }

    console.log(`📦 Archived ${records.length} tracking numbers for shipment ${shipmentId}`);
  }

  /**
   * Auto-expire old tracking numbers (maintenance task)
   */
  async expireOldTrackingNumbers(): Promise<number> {
    // TODO: Query database for expired tracking numbers
    // SELECT tracking_number FROM tracking_numbers
    // WHERE status = 'ACTIVE' AND expires_at < NOW()

    const now = new Date();
    let expiredCount = 0;

    // Check cache
    for (const [trackingNumber, record] of this.cache.entries()) {
      if (record.status === 'ACTIVE' && record.expiresAt && record.expiresAt < now) {
        await this.archiveTrackingNumber(trackingNumber, 'Expired');
        expiredCount++;
      }
    }

    console.log(`⏰ Expired ${expiredCount} tracking numbers`);
    return expiredCount;
  }

  // ============================================================================
  // STATISTICS & REPORTING
  // ============================================================================

  /**
   * Get tracking number statistics for a shipment
   */
  async getShipmentStatistics(shipmentId: string): Promise<{
    total: number;
    active: number;
    expired: number;
    archived: number;
    revoked: number;
    byRole: Record<UserRole, number>;
  }> {
    const records = await this.getTrackingNumbersForShipment(shipmentId, true);

    const stats = {
      total: records.length,
      active: 0,
      expired: 0,
      archived: 0,
      revoked: 0,
      byRole: {
        SUPPLIER: 0,
        RECIPIENT: 0,
        MANAGER: 0,
      } as Record<UserRole, number>,
    };

    for (const record of records) {
      // Count by status
      if (record.status === 'ACTIVE') stats.active++;
      else if (record.status === 'EXPIRED') stats.expired++;
      else if (record.status === 'ARCHIVED') stats.archived++;
      else if (record.status === 'REVOKED') stats.revoked++;

      // Count by role
      stats.byRole[record.role]++;
    }

    return stats;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const trackingNumberManager = new TrackingNumberManager();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Validate tracking number format
 */
export function validateTrackingNumberFormat(trackingNumber: string): boolean {
  const pattern = /^(SUPP|RECV|MGR)-[A-Z0-9]+-[A-Z0-9]{4}$/;
  return pattern.test(trackingNumber);
}

/**
 * Extract role from tracking number
 */
export function extractRoleFromTrackingNumber(trackingNumber: string): UserRole | null {
  if (trackingNumber.startsWith('SUPP-')) return UserRole.SUPPLIER;
  if (trackingNumber.startsWith('RECV-')) return UserRole.RECIPIENT;
  if (trackingNumber.startsWith('MGR-')) return UserRole.MANAGER;
  return null;
}
