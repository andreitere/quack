# Quack

Run Quackbook close to your data. A thin, hono based wrapper for Quackbook and DuckDB 🔥.

## Features

- REST API for DuckDB operations
- Support for both regular queries and streaming large datasets
- [Quackbook](https://github.com/andreitere/quackbook) on your local machine.

## To run it

```bash
npx andreitere/quack --port 3001 --open
```

## Dependencies

- [@duckdb/node-api](https://github.com/duckdb/duckdb-node-api)
- [Hono](https://hono.dev/)
