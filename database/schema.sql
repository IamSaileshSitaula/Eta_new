-- Logistics B2B Delivery Tracking Database Schema
-- PostgreSQL 14+
-- Author: Rerouting Engine Implementation
-- Date: November 2025

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE SHIPMENT TABLES
-- ============================================================================

-- Shipments table
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_number VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    current_leg_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Origin and Hub references
    origin_stop_id UUID,
    hub_stop_id UUID,
    
    CONSTRAINT shipment_status_check CHECK (
        status IN ('PENDING', 'IN_TRANSIT_LONG_HAUL', 'AT_HUB', 
                   'IN_TRANSIT_LAST_MILE', 'DELIVERED', 'DELAYED')
    )
);

CREATE INDEX idx_shipments_tracking ON shipments(tracking_number);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_created ON shipments(created_at DESC);

-- Stops table (origin, hub, long-haul, last-mile)
CREATE TABLE stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    stop_type VARCHAR(50) NOT NULL, -- 'ORIGIN', 'HUB', 'LONG_HAUL', 'LAST_MILE'
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    sequence_order INTEGER, -- For last-mile stops
    unloading_time_minutes INTEGER DEFAULT 0,
    actual_arrival_time TIMESTAMP WITH TIME ZONE,
    estimated_arrival_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT stop_type_check CHECK (
        stop_type IN ('ORIGIN', 'HUB', 'LONG_HAUL', 'LAST_MILE')
    ),
    CONSTRAINT stop_status_check CHECK (
        status IN ('PENDING', 'IN_PROGRESS', 'UNLOADING', 'COMPLETED')
    )
);

CREATE INDEX idx_stops_shipment ON stops(shipment_id);
CREATE INDEX idx_stops_type ON stops(stop_type);
CREATE INDEX idx_stops_sequence ON stops(shipment_id, sequence_order);

-- Shipment items table
CREATE TABLE shipment_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    contents VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    destination_stop_id UUID REFERENCES stops(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT quantity_positive CHECK (quantity > 0)
);

CREATE INDEX idx_items_shipment ON shipment_items(shipment_id);
CREATE INDEX idx_items_destination ON shipment_items(destination_stop_id);

-- ============================================================================
-- ROUTE MANAGEMENT TABLES
-- ============================================================================

-- Route plans (stores alternative routes)
CREATE TABLE route_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    route_type VARCHAR(50) NOT NULL, -- 'LONG_HAUL', 'LAST_MILE'
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Route metadata
    total_distance_miles DECIMAL(10, 2),
    estimated_duration_minutes INTEGER,
    
    CONSTRAINT route_type_check CHECK (
        route_type IN ('LONG_HAUL', 'LAST_MILE')
    )
);

CREATE INDEX idx_route_plans_shipment ON route_plans(shipment_id);
CREATE INDEX idx_route_plans_active ON route_plans(shipment_id, is_active);

-- Route options (individual alternative routes)
CREATE TABLE route_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_plan_id UUID NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
    option_name VARCHAR(100), -- 'route-1', 'route-2', etc.
    is_recommended BOOLEAN DEFAULT false,
    is_selected BOOLEAN DEFAULT false,
    
    -- Route metrics
    total_distance_miles DECIMAL(10, 2) NOT NULL,
    estimated_duration_minutes INTEGER NOT NULL,
    toll_road_miles DECIMAL(10, 2) DEFAULT 0,
    highway_miles DECIMAL(10, 2) DEFAULT 0,
    traffic_risk_score DECIMAL(3, 2) DEFAULT 0, -- 0.00 to 1.00
    weather_risk_score DECIMAL(3, 2) DEFAULT 0, -- 0.00 to 1.00
    composite_score DECIMAL(5, 2), -- Ranking score
    
    -- Route path (stored as JSON array of coordinates)
    path_coordinates JSONB NOT NULL, -- [[lat1, lng1], [lat2, lng2], ...]
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT risk_score_range CHECK (
        traffic_risk_score BETWEEN 0 AND 1 AND
        weather_risk_score BETWEEN 0 AND 1
    )
);

CREATE INDEX idx_route_options_plan ON route_options(route_plan_id);
CREATE INDEX idx_route_options_selected ON route_options(is_selected);
CREATE INDEX idx_route_options_score ON route_options(composite_score DESC);

-- ============================================================================
-- TRACKING & AUTHENTICATION TABLES
-- ============================================================================

-- Tracking numbers (maps to shipments with role-based access)
CREATE TABLE tracking_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_number VARCHAR(50) UNIQUE NOT NULL,
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    recipient_stop_id UUID REFERENCES stops(id), -- For RECIPIENT role
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT tracking_role_check CHECK (
        role IN ('SUPPLIER', 'RECIPIENT', 'MANAGER')
    )
);

CREATE INDEX idx_tracking_numbers ON tracking_numbers(tracking_number);
CREATE INDEX idx_tracking_shipment ON tracking_numbers(shipment_id);
CREATE INDEX idx_tracking_role ON tracking_numbers(role);

-- ============================================================================
-- REROUTING & EVENT TABLES
-- ============================================================================

-- Reroute events (audit log of all rerouting decisions)
CREATE TABLE reroute_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    triggered_by VARCHAR(50) NOT NULL, -- 'MANAGER', 'AUTOMATIC'
    
    -- Event details (stored as JSONB for flexibility)
    changes JSONB NOT NULL, -- { affectedStops, oldETAs, newETAs, reason, routeChange }
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT event_type_check CHECK (
        event_type IN ('LONG_HAUL_REROUTE', 'LAST_MILE_RESEQUENCE', 'ROUTE_SWITCH')
    ),
    CONSTRAINT triggered_by_check CHECK (
        triggered_by IN ('MANAGER', 'AUTOMATIC')
    )
);

CREATE INDEX idx_reroute_events_shipment ON reroute_events(shipment_id);
CREATE INDEX idx_reroute_events_created ON reroute_events(created_at DESC);
CREATE INDEX idx_reroute_events_type ON reroute_events(event_type);

-- Notifications queue (for real-time updates to users)
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_number VARCHAR(50) NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    
    -- Additional notification data
    old_eta TIMESTAMP WITH TIME ZONE,
    new_eta TIMESTAMP WITH TIME ZONE,
    old_position INTEGER,
    new_position INTEGER,
    
    -- Status tracking
    is_read BOOLEAN DEFAULT false,
    is_sent BOOLEAN DEFAULT false, -- For browser notifications
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT notification_type_check CHECK (
        notification_type IN ('ETA_UPDATE', 'REROUTE', 'SEQUENCE_CHANGE', 'DELIVERY_STATUS')
    )
);

CREATE INDEX idx_notifications_tracking ON notifications(tracking_number);
CREATE INDEX idx_notifications_unread ON notifications(tracking_number, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- ============================================================================
-- ML MODEL PERFORMANCE TRACKING
-- ============================================================================

-- Model predictions (for accuracy tracking)
CREATE TABLE model_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    model_type VARCHAR(50) NOT NULL, -- 'ETA', 'ROUTE_OPTIMIZATION'
    
    -- Prediction data
    predicted_value DECIMAL(10, 2) NOT NULL, -- ETA minutes or route score
    actual_value DECIMAL(10, 2), -- Filled in after completion
    confidence_score DECIMAL(3, 2), -- 0.00 to 1.00
    
    -- Context
    input_features JSONB, -- Store input for debugging
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT model_type_check CHECK (
        model_type IN ('ETA', 'ROUTE_OPTIMIZATION', 'LAST_MILE_SEQUENCE')
    )
);

CREATE INDEX idx_predictions_shipment ON model_predictions(shipment_id);
CREATE INDEX idx_predictions_model ON model_predictions(model_type);
CREATE INDEX idx_predictions_created ON model_predictions(created_at DESC);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active shipments with current location
CREATE OR REPLACE VIEW active_shipments AS
SELECT 
    s.id,
    s.tracking_number,
    s.status,
    s.current_leg_index,
    s.created_at,
    origin.name as origin_name,
    origin.latitude as origin_lat,
    origin.longitude as origin_lng,
    hub.name as hub_name,
    hub.latitude as hub_lat,
    hub.longitude as hub_lng,
    (SELECT COUNT(*) FROM stops WHERE shipment_id = s.id AND stop_type = 'LAST_MILE') as last_mile_count
FROM shipments s
LEFT JOIN stops origin ON s.origin_stop_id = origin.id
LEFT JOIN stops hub ON s.hub_stop_id = hub.id
WHERE s.status != 'DELIVERED';

-- Reroute event history with details
CREATE OR REPLACE VIEW reroute_history AS
SELECT 
    re.id,
    re.shipment_id,
    s.tracking_number,
    re.event_type,
    re.triggered_by,
    re.changes,
    re.created_at,
    (SELECT COUNT(*) FROM notifications WHERE tracking_number = s.tracking_number 
     AND created_at >= re.created_at AND created_at < re.created_at + INTERVAL '5 minutes') as notifications_sent
FROM reroute_events re
JOIN shipments s ON re.shipment_id = s.id
ORDER BY re.created_at DESC;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shipments_updated_at
    BEFORE UPDATE ON shipments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER model_predictions_updated_at
    BEFORE UPDATE ON model_predictions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- SAMPLE DATA (for development/testing)
-- ============================================================================

-- Insert sample shipment
INSERT INTO shipments (id, tracking_number, status, current_leg_index)
VALUES ('00000000-0000-0000-0000-000000000001', 'SHIP001', 'PENDING', 0);

-- Insert origin stop
INSERT INTO stops (id, shipment_id, name, stop_type, latitude, longitude, status)
VALUES (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    'Manufacturer, Austin, TX',
    'ORIGIN',
    30.2672,
    -97.7431,
    'COMPLETED'
);

-- Insert hub stop
INSERT INTO stops (id, shipment_id, name, stop_type, latitude, longitude, status)
VALUES (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000001',
    'Distribution Hub, Beaumont, TX',
    'HUB',
    30.0833,
    -94.1250,
    'PENDING'
);

-- Insert last-mile stops
INSERT INTO stops (shipment_id, name, stop_type, latitude, longitude, status, sequence_order, unloading_time_minutes)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Gas Station', 'LAST_MILE', 29.9980, -94.0900, 'PENDING', 1, 10),
    ('00000000-0000-0000-0000-000000000001', 'Super 8, Port Arthur', 'LAST_MILE', 29.9500, -94.0000, 'PENDING', 2, 15),
    ('00000000-0000-0000-0000-000000000001', 'Liquor Store', 'LAST_MILE', 29.9900, -93.9200, 'PENDING', 3, 10);

-- Update shipment with stop references
UPDATE shipments
SET 
    origin_stop_id = '00000000-0000-0000-0000-000000000101',
    hub_stop_id = '00000000-0000-0000-0000-000000000102'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Insert tracking numbers
INSERT INTO tracking_numbers (tracking_number, shipment_id, role)
VALUES
    ('SUPPLIER123', '00000000-0000-0000-0000-000000000001', 'SUPPLIER'),
    ('MANAGER789', '00000000-0000-0000-0000-000000000001', 'MANAGER');

INSERT INTO tracking_numbers (tracking_number, shipment_id, role, recipient_stop_id)
SELECT 
    'SUPER8-456',
    '00000000-0000-0000-0000-000000000001',
    'RECIPIENT',
    id
FROM stops
WHERE shipment_id = '00000000-0000-0000-0000-000000000001'
  AND name = 'Super 8, Port Arthur';

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function to get active route for shipment
CREATE OR REPLACE FUNCTION get_active_route(p_shipment_id UUID, p_route_type VARCHAR)
RETURNS TABLE (
    route_option_id UUID,
    path_coordinates JSONB,
    total_distance DECIMAL,
    estimated_duration INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ro.id,
        ro.path_coordinates,
        ro.total_distance_miles,
        ro.estimated_duration_minutes
    FROM route_options ro
    JOIN route_plans rp ON ro.route_plan_id = rp.id
    WHERE rp.shipment_id = p_shipment_id
      AND rp.route_type = p_route_type
      AND rp.is_active = true
      AND ro.is_selected = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to publish reroute event
CREATE OR REPLACE FUNCTION publish_reroute_event(
    p_shipment_id UUID,
    p_event_type VARCHAR,
    p_triggered_by VARCHAR,
    p_changes JSONB
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    -- Insert event
    INSERT INTO reroute_events (shipment_id, event_type, triggered_by, changes)
    VALUES (p_shipment_id, p_event_type, p_triggered_by, p_changes)
    RETURNING id INTO v_event_id;
    
    -- Update shipment timestamp
    UPDATE shipments SET updated_at = CURRENT_TIMESTAMP WHERE id = p_shipment_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON DATABASE logistics_b2b IS 'Logistics B2B Delivery Tracking System with ML-powered rerouting';
