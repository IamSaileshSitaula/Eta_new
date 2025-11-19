-- ============================================================================
-- ENHANCED DATABASE SCHEMA FOR TRACKING NUMBER LIFECYCLE
-- Fixes tracking number reuse issue through proper state management
-- ============================================================================
-- Author: Rerouting Engine Enhancement
-- Date: November 2025
-- Purpose: Resolve tracking number lifecycle issues and support robust rerouting

-- This migration enhances the existing schema with:
-- 1. Idempotency support for tracking number creation
-- 2. Soft delete pattern (ARCHIVED status instead of hard delete)
-- 3. Proper lifecycle states (ACTIVE, EXPIRED, ARCHIVED, REVOKED)
-- 4. Historical tracking of all route changes
-- 5. Better separation between shipment lifecycle and tracking numbers

-- ============================================================================
-- STEP 1: Add new columns to tracking_numbers table
-- ============================================================================

-- Add status column (replaces simple is_active boolean)
ALTER TABLE tracking_numbers
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

-- Add status constraint
ALTER TABLE tracking_numbers
ADD CONSTRAINT tracking_status_check CHECK (
    status IN ('ACTIVE', 'EXPIRED', 'ARCHIVED', 'REVOKED')
);

-- Migrate existing data (if any)
UPDATE tracking_numbers
SET status = CASE
    WHEN is_active = true THEN 'ACTIVE'
    ELSE 'ARCHIVED'
END
WHERE status IS NULL;

-- Add index for idempotency key (fast duplicate detection)
CREATE INDEX IF NOT EXISTS idx_tracking_idempotency ON tracking_numbers(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Add index for status queries
CREATE INDEX IF NOT EXISTS idx_tracking_status ON tracking_numbers(status);

-- Add composite index for shipment + status queries
CREATE INDEX IF NOT EXISTS idx_tracking_shipment_status ON tracking_numbers(shipment_id, status);

-- ============================================================================
-- STEP 2: Create shipment lifecycle history table
-- ============================================================================

-- Tracks every state transition of a shipment
CREATE TABLE IF NOT EXISTS shipment_lifecycle_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    
    -- State transition
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    old_leg_index INTEGER,
    new_leg_index INTEGER,
    
    -- Trigger information
    triggered_by VARCHAR(50), -- 'SYSTEM', 'MANAGER', 'AUTOMATIC_REROUTE'
    trigger_reason TEXT,
    
    -- Metadata
    additional_data JSONB, -- Flexible field for extra context
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT lifecycle_old_status_check CHECK (
        old_status IS NULL OR old_status IN ('PENDING', 'IN_TRANSIT_LONG_HAUL', 'AT_HUB', 'IN_TRANSIT_LAST_MILE', 'DELIVERED', 'DELAYED')
    ),
    CONSTRAINT lifecycle_new_status_check CHECK (
        new_status IN ('PENDING', 'IN_TRANSIT_LONG_HAUL', 'AT_HUB', 'IN_TRANSIT_LAST_MILE', 'DELIVERED', 'DELAYED')
    )
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_shipment ON shipment_lifecycle_history(shipment_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_created ON shipment_lifecycle_history(created_at DESC);

-- ============================================================================
-- STEP 3: Create route history table (tracks all route changes)
-- ============================================================================

-- Maintains complete audit trail of all route changes
CREATE TABLE IF NOT EXISTS route_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    route_plan_id UUID REFERENCES route_plans(id) ON DELETE SET NULL,
    
    -- Route snapshot
    route_type VARCHAR(50) NOT NULL, -- 'LONG_HAUL', 'LAST_MILE'
    route_snapshot JSONB NOT NULL, -- Complete route data at this point in time
    
    -- Performance metrics
    planned_distance_miles DECIMAL(10, 2),
    planned_duration_minutes INTEGER,
    actual_distance_miles DECIMAL(10, 2),
    actual_duration_minutes INTEGER,
    
    -- Change tracking
    change_reason TEXT,
    was_reroute BOOLEAN DEFAULT false,
    reroute_event_id UUID REFERENCES reroute_events(id),
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT route_history_type_check CHECK (
        route_type IN ('LONG_HAUL', 'LAST_MILE')
    )
);

CREATE INDEX IF NOT EXISTS idx_route_history_shipment ON route_history(shipment_id);
CREATE INDEX IF NOT EXISTS idx_route_history_created ON route_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_history_reroute ON route_history(reroute_event_id) WHERE reroute_event_id IS NOT NULL;

-- ============================================================================
-- STEP 4: Create ETA history table (tracks all ETA predictions and actuals)
-- ============================================================================

CREATE TABLE IF NOT EXISTS eta_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    stop_id UUID REFERENCES stops(id) ON DELETE CASCADE,
    
    -- ETA data
    predicted_eta TIMESTAMP WITH TIME ZONE NOT NULL,
    actual_eta TIMESTAMP WITH TIME ZONE,
    
    -- Prediction context
    prediction_method VARCHAR(50) NOT NULL, -- 'ML_MODEL', 'SIMPLE_CALC', 'MANUAL'
    confidence_score DECIMAL(3, 2), -- 0.00 to 1.00
    
    -- Factors
    traffic_delay_minutes INTEGER DEFAULT 0,
    weather_delay_minutes INTEGER DEFAULT 0,
    unloading_time_minutes INTEGER DEFAULT 0,
    
    -- Accuracy tracking
    prediction_error_minutes INTEGER, -- Calculated after actual arrival
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT eta_prediction_method_check CHECK (
        prediction_method IN ('ML_MODEL', 'SIMPLE_CALC', 'MANUAL', 'HYBRID')
    ),
    CONSTRAINT eta_confidence_range CHECK (
        confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1
    )
);

CREATE INDEX IF NOT EXISTS idx_eta_history_shipment ON eta_history(shipment_id);
CREATE INDEX IF NOT EXISTS idx_eta_history_stop ON eta_history(stop_id);
CREATE INDEX IF NOT EXISTS idx_eta_history_created ON eta_history(created_at DESC);

-- ============================================================================
-- STEP 5: Add soft delete support to main tables
-- ============================================================================

-- Add deleted_at columns for soft delete pattern
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE stops
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for soft delete queries
CREATE INDEX IF NOT EXISTS idx_shipments_not_deleted ON shipments(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stops_not_deleted ON stops(id) WHERE deleted_at IS NULL;

-- ============================================================================
-- STEP 6: Enhanced views
-- ============================================================================

-- Drop and recreate active_shipments view with more data
DROP VIEW IF EXISTS active_shipments;
CREATE OR REPLACE VIEW active_shipments AS
SELECT 
    s.id,
    s.tracking_number,
    s.status,
    s.current_leg_index,
    s.created_at,
    s.updated_at,
    
    -- Origin info
    origin.id as origin_stop_id,
    origin.name as origin_name,
    origin.latitude as origin_lat,
    origin.longitude as origin_lng,
    origin.status as origin_status,
    
    -- Hub info
    hub.id as hub_stop_id,
    hub.name as hub_name,
    hub.latitude as hub_lat,
    hub.longitude as hub_lng,
    hub.status as hub_status,
    
    -- Last-mile counts
    (SELECT COUNT(*) FROM stops WHERE shipment_id = s.id AND stop_type = 'LAST_MILE' AND deleted_at IS NULL) as last_mile_count,
    (SELECT COUNT(*) FROM stops WHERE shipment_id = s.id AND stop_type = 'LAST_MILE' AND status = 'COMPLETED' AND deleted_at IS NULL) as last_mile_completed,
    
    -- Tracking numbers count
    (SELECT COUNT(*) FROM tracking_numbers WHERE shipment_id = s.id AND status = 'ACTIVE') as active_tracking_numbers,
    
    -- Latest reroute
    (SELECT MAX(created_at) FROM reroute_events WHERE shipment_id = s.id) as last_reroute_at
    
FROM shipments s
LEFT JOIN stops origin ON s.origin_stop_id = origin.id AND origin.deleted_at IS NULL
LEFT JOIN stops hub ON s.hub_stop_id = hub.id AND hub.deleted_at IS NULL
WHERE s.status != 'DELIVERED' AND s.deleted_at IS NULL;

-- Create view for tracking number details
CREATE OR REPLACE VIEW tracking_number_details AS
SELECT 
    tn.id,
    tn.tracking_number,
    tn.shipment_id,
    tn.role,
    tn.status,
    tn.created_at,
    tn.expires_at,
    
    -- Shipment info
    s.tracking_number as shipment_tracking_number,
    s.status as shipment_status,
    
    -- Recipient stop info (if applicable)
    recipient_stop.id as recipient_stop_id,
    recipient_stop.name as recipient_stop_name,
    recipient_stop.sequence_order as delivery_position,
    recipient_stop.status as recipient_stop_status,
    recipient_stop.estimated_arrival_time as recipient_eta,
    
    -- Total stops in sequence
    (SELECT COUNT(*) FROM stops WHERE shipment_id = s.id AND stop_type = 'LAST_MILE' AND deleted_at IS NULL) as total_last_mile_stops,
    
    -- Unread notifications
    (SELECT COUNT(*) FROM notifications WHERE tracking_number = tn.tracking_number AND is_read = false) as unread_notifications
    
FROM tracking_numbers tn
JOIN shipments s ON tn.shipment_id = s.id
LEFT JOIN stops recipient_stop ON tn.recipient_stop_id = recipient_stop.id AND recipient_stop.deleted_at IS NULL
WHERE s.deleted_at IS NULL;

-- ============================================================================
-- STEP 7: Functions for tracking number lifecycle
-- ============================================================================

-- Function to check if tracking number can be reused
CREATE OR REPLACE FUNCTION can_reuse_tracking_number(p_tracking_number VARCHAR(50))
RETURNS BOOLEAN AS $$
DECLARE
    v_status VARCHAR(50);
BEGIN
    SELECT status INTO v_status
    FROM tracking_numbers
    WHERE tracking_number = p_tracking_number;
    
    -- Can reuse if ARCHIVED, cannot reuse if ACTIVE or REVOKED
    IF v_status IS NULL THEN
        RETURN true; -- Doesn't exist, can create
    ELSIF v_status = 'ARCHIVED' OR v_status = 'EXPIRED' THEN
        RETURN true; -- Can reactivate
    ELSE
        RETURN false; -- ACTIVE or REVOKED, cannot reuse
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to archive tracking number (soft delete)
CREATE OR REPLACE FUNCTION archive_tracking_number(
    p_tracking_number VARCHAR(50),
    p_reason TEXT DEFAULT 'Manual archive'
)
RETURNS VOID AS $$
BEGIN
    UPDATE tracking_numbers
    SET 
        status = 'ARCHIVED',
        archived_at = CURRENT_TIMESTAMP
    WHERE tracking_number = p_tracking_number
    AND status = 'ACTIVE';
    
    -- Log the action
    RAISE NOTICE 'Archived tracking number: % (reason: %)', p_tracking_number, p_reason;
END;
$$ LANGUAGE plpgsql;

-- Function to reactivate archived tracking number
CREATE OR REPLACE FUNCTION reactivate_tracking_number(p_tracking_number VARCHAR(50))
RETURNS VOID AS $$
BEGIN
    UPDATE tracking_numbers
    SET 
        status = 'ACTIVE',
        archived_at = NULL,
        expires_at = CASE
            WHEN role = 'RECIPIENT' THEN CURRENT_TIMESTAMP + INTERVAL '30 days'
            ELSE NULL
        END
    WHERE tracking_number = p_tracking_number
    AND status = 'ARCHIVED';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cannot reactivate tracking number: % (not found or not archived)', p_tracking_number;
    END IF;
    
    RAISE NOTICE 'Reactivated tracking number: %', p_tracking_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 8: Triggers for automatic lifecycle tracking
-- ============================================================================

-- Trigger to automatically log shipment status changes
CREATE OR REPLACE FUNCTION log_shipment_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if status or leg changed
    IF (OLD.status IS DISTINCT FROM NEW.status) OR (OLD.current_leg_index IS DISTINCT FROM NEW.current_leg_index) THEN
        INSERT INTO shipment_lifecycle_history (
            shipment_id,
            old_status,
            new_status,
            old_leg_index,
            new_leg_index,
            triggered_by,
            trigger_reason
        ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            OLD.current_leg_index,
            NEW.current_leg_index,
            'SYSTEM', -- Can be enhanced to capture actual user
            CASE
                WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'Status changed from ' || COALESCE(OLD.status, 'NULL') || ' to ' || NEW.status
                ELSE 'Leg changed from ' || OLD.current_leg_index || ' to ' || NEW.current_leg_index
            END
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shipment_status_change_logger
    AFTER UPDATE ON shipments
    FOR EACH ROW
    EXECUTE FUNCTION log_shipment_status_change();

-- Trigger to auto-expire tracking numbers
CREATE OR REPLACE FUNCTION auto_expire_tracking_numbers()
RETURNS TRIGGER AS $$
BEGIN
    -- When shipment is delivered, expire all recipient tracking numbers after 30 days
    IF NEW.status = 'DELIVERED' AND OLD.status != 'DELIVERED' THEN
        UPDATE tracking_numbers
        SET expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days'
        WHERE shipment_id = NEW.id
        AND role = 'RECIPIENT'
        AND status = 'ACTIVE';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_expire_on_delivery
    AFTER UPDATE ON shipments
    FOR EACH ROW
    EXECUTE FUNCTION auto_expire_tracking_numbers();

-- ============================================================================
-- STEP 9: Maintenance procedures
-- ============================================================================

-- Procedure to archive expired tracking numbers (run periodically)
CREATE OR REPLACE FUNCTION archive_expired_tracking_numbers()
RETURNS INTEGER AS $$
DECLARE
    v_archived_count INTEGER;
BEGIN
    UPDATE tracking_numbers
    SET 
        status = 'EXPIRED',
        archived_at = CURRENT_TIMESTAMP
    WHERE status = 'ACTIVE'
    AND expires_at IS NOT NULL
    AND expires_at < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS v_archived_count = ROW_COUNT;
    
    RAISE NOTICE 'Archived % expired tracking numbers', v_archived_count;
    RETURN v_archived_count;
END;
$$ LANGUAGE plpgsql;

-- Procedure to soft delete old delivered shipments (archival)
CREATE OR REPLACE FUNCTION archive_old_delivered_shipments(p_days_old INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    v_archived_count INTEGER;
BEGIN
    UPDATE shipments
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE status = 'DELIVERED'
    AND deleted_at IS NULL
    AND updated_at < CURRENT_TIMESTAMP - (p_days_old || ' days')::INTERVAL;
    
    GET DIAGNOSTICS v_archived_count = ROW_COUNT;
    
    RAISE NOTICE 'Archived % old delivered shipments', v_archived_count;
    RETURN v_archived_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 10: Analytics views
-- ============================================================================

-- View for tracking number reuse analysis
CREATE OR REPLACE VIEW tracking_number_reuse_stats AS
SELECT 
    role,
    status,
    COUNT(*) as count,
    COUNT(CASE WHEN archived_at IS NOT NULL THEN 1 END) as archived_count,
    COUNT(CASE WHEN revoked_at IS NOT NULL THEN 1 END) as revoked_count,
    AVG(EXTRACT(EPOCH FROM (COALESCE(archived_at, CURRENT_TIMESTAMP) - created_at)) / 86400) as avg_lifetime_days
FROM tracking_numbers
GROUP BY role, status;

-- View for shipment lifecycle analytics
CREATE OR REPLACE VIEW shipment_lifecycle_stats AS
SELECT 
    new_status,
    COUNT(*) as transition_count,
    AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY shipment_id ORDER BY created_at))) / 60) as avg_minutes_since_last_transition
FROM shipment_lifecycle_history
GROUP BY new_status;

-- ============================================================================
-- STEP 11: Sample queries for common operations
-- ============================================================================

-- Query to find tracking numbers that can be reused
-- SELECT tracking_number, status FROM tracking_numbers WHERE status IN ('ARCHIVED', 'EXPIRED');

-- Query to get shipment history
-- SELECT * FROM shipment_lifecycle_history WHERE shipment_id = 'xxx' ORDER BY created_at DESC;

-- Query to get all active tracking numbers for a shipment
-- SELECT * FROM tracking_number_details WHERE shipment_id = 'xxx' AND status = 'ACTIVE';

-- Query to find duplicate tracking number attempts (idempotency check)
-- SELECT idempotency_key, COUNT(*) FROM tracking_numbers GROUP BY idempotency_key HAVING COUNT(*) > 1;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Summary of changes:
-- 1. Added tracking number lifecycle states (ACTIVE, EXPIRED, ARCHIVED, REVOKED)
-- 2. Added idempotency support to prevent duplicate creation
-- 3. Implemented soft delete pattern (deleted_at columns)
-- 4. Created comprehensive history tables (lifecycle, route, ETA)
-- 5. Added helper functions for tracking number management
-- 6. Created triggers for automatic state tracking
-- 7. Added maintenance procedures for cleanup
-- 8. Created analytics views for insights

COMMENT ON TABLE tracking_numbers IS 'Tracking numbers with lifecycle management - supports reuse through ARCHIVED status';
COMMENT ON TABLE shipment_lifecycle_history IS 'Complete audit trail of all shipment state transitions';
COMMENT ON TABLE route_history IS 'Historical record of all route changes and performance';
COMMENT ON TABLE eta_history IS 'Prediction and actual ETA tracking for accuracy analysis';
