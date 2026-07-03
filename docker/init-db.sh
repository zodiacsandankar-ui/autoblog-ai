#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE autoblog_test;
    GRANT ALL PRIVILEGES ON DATABASE autoblog_test TO autoblog;
EOSQL

echo "Databases initialized successfully"
