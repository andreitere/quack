# Quack

A cool DuckDB query server built with Hono and Node.js. Quack provides a RESTful API interface for executing SQL queries against DuckDB databases, with support for both regular queries and streaming large datasets.

## Features

- RESTful API for DuckDB operations
- Support for both regular queries and streaming large datasets
- Type conversion for DuckDB-specific data types
- CORS enabled by default
- Request timing and ID tracking
- Configurable host, port, and database path

## Installation

```bash
# Install dependencies
pnpm install
```

## Usage

### Starting the Server

```bash
# Development mode with hot reload
pnpm dev

# Production mode
pnpm start
```

### Configuration Options

The server accepts the following command-line arguments:

- `--port`: Port number (default: 3000)
- `--host`: Host address (default: "0.0.0.0")
- `--db`: Database path (default: ":memory:")

Example:
```bash
pnpm start -- --port 8080 --host localhost --db ./data/my_database.duckdb
```

## API Endpoints

### POST /query
Execute a SQL query and return the results.

Request body:
```json
{
  "query": "SELECT * FROM table",
  "withColumns": false
}
```

### POST /stream
Execute a SQL query and stream the results.

Request body:
```json
{
  "query": "SELECT * FROM large_table",
  "bufferSize": 100000
}
```

### GET /duckdb
Returns the version of DuckDB being used.

### POST /describe
Returns the column names and types for a given query.

## Dependencies

- [@duckdb/node-api](https://github.com/duckdb/duckdb-node-api)
- [Hono](https://hono.dev/)
- [Nodemon](https://nodemon.io/) (development)
