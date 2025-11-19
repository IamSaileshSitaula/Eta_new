-- Quick Setup Script for PostgreSQL Database
-- Run this to initialize the database

-- Create database (run as postgres superuser)
CREATE DATABASE logistics_b2b
    WITH 
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1;

-- Connect to the database
\c logistics_b2b;

-- Run the schema
\i schema.sql

-- Verify tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
