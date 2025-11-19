# Database Configuration

## PostgreSQL Setup

### Prerequisites
- PostgreSQL 14 or higher
- psql command-line tool

### Installation

**Windows:**
```bash
# Download from https://www.postgresql.org/download/windows/
# Or use Chocolatey
choco install postgresql14
```

**macOS:**
```bash
brew install postgresql@14
brew services start postgresql@14
```

**Linux:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Database Initialization

1. **Create Database**
```bash
# Connect as postgres user
psql -U postgres

# Run setup script
\i database/setup.sql

# Or manually:
CREATE DATABASE logistics_b2b;
\c logistics_b2b
\i database/schema.sql
```

2. **Verify Installation**
```bash
psql -U postgres -d logistics_b2b -c "SELECT COUNT(*) FROM shipments;"
# Should return: count 1 (sample shipment)
```

3. **Connection String**
```
postgresql://postgres:password@localhost:5432/logistics_b2b
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/logistics_b2b
DB_HOST=localhost
DB_PORT=5432
DB_NAME=logistics_b2b
DB_USER=postgres
DB_PASSWORD=your_password_here

# Application
NODE_ENV=development
PORT=3000

# ML Backend
ML_BACKEND_URL=http://localhost:8000
```

### Database Schema

The schema includes:

**Core Tables:**
- `shipments` - Main shipment records
- `stops` - All stop locations (origin, hub, long-haul, last-mile)
- `shipment_items` - Items in each shipment
- `route_plans` - Route planning records
- `route_options` - Alternative route options
- `tracking_numbers` - Role-based tracking access
- `reroute_events` - Audit log of rerouting decisions
- `notifications` - Real-time notification queue
- `model_predictions` - ML model performance tracking

**Views:**
- `active_shipments` - Currently active deliveries
- `reroute_history` - Historical reroute events with details

**Functions:**
- `get_active_route()` - Retrieve active route for shipment
- `publish_reroute_event()` - Create and log reroute events

### Sample Data

The schema includes sample data for testing:
- 1 shipment: `SHIP001`
- 3 tracking numbers: `SUPPLIER123`, `SUPER8-456`, `MANAGER789`
- 1 origin, 1 hub, 3 last-mile stops

### Migration from localStorage

To migrate existing tracking numbers from localStorage:

1. Export from browser console:
```javascript
const data = localStorage.getItem('shipmentData');
console.log(JSON.stringify(JSON.parse(data), null, 2));
```

2. Import to database:
```sql
-- Insert shipments, stops, tracking numbers using exported data
-- See migration script in database/migrate_from_localstorage.ts
```

### Maintenance

**Backup Database:**
```bash
pg_dump -U postgres logistics_b2b > backup_$(date +%Y%m%d).sql
```

**Restore Database:**
```bash
psql -U postgres -d logistics_b2b < backup_20250116.sql
```

**Clean old notifications (older than 30 days):**
```sql
DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days';
```

**View active shipments:**
```sql
SELECT * FROM active_shipments;
```

**View recent reroute events:**
```sql
SELECT * FROM reroute_history LIMIT 10;
```

### Performance Tips

1. **Connection Pooling** - Use a connection pool (e.g., `pg-pool`) to manage connections efficiently
2. **Indexes** - The schema includes indexes on frequently queried columns
3. **JSONB** - Uses JSONB for flexible data storage with indexing support
4. **Partitioning** - Consider partitioning `reroute_events` and `notifications` tables by date for large datasets

### Troubleshooting

**Connection refused:**
- Check PostgreSQL is running: `sudo systemctl status postgresql` (Linux) or `brew services list` (macOS)
- Verify `pg_hba.conf` allows local connections

**Permission denied:**
- Grant permissions: `GRANT ALL PRIVILEGES ON DATABASE logistics_b2b TO postgres;`

**Schema not found:**
- Ensure you're connected to the correct database: `\c logistics_b2b`

### Next Steps

1. Install Node.js PostgreSQL client: `npm install pg`
2. Create repository pattern files (see `services/repositories/`)
3. Update application to use database instead of localStorage
4. Test reroute event propagation with database persistence
