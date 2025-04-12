#!/usr/bin/env node
import express from "express";
import cors from "cors";
import duckdb from "@duckdb/node-api";
import { DuckDBTypeId } from "@duckdb/node-api";
import winston from "winston";
import open from "open";
import path from "path";
import { fileURLToPath } from "url";
import arg from "arg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = arg({
  "--port": Number,
  "--host": String,
  "--db": String,
  "--open": Boolean,
});

const port = args["--port"] || 3000;
const host = args["--host"] || "localhost";
const db = args["--db"] || ":memory:";
const openBrowser = args["--open"] || false;

// Configure Winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

BigInt.prototype.toJSON = function () {
  return this.toString();
};

const convertDuckDBValue = (value, typeId) => {
  if (value === null) return null;

  switch (typeId) {
    case DuckDBTypeId.DATE:
      return new Date(value.days * 24 * 60 * 60 * 1000).toISOString();

    case DuckDBTypeId.TIMESTAMP:
    case DuckDBTypeId.TIMESTAMP_TZ:
      return new Date(Number(value.micros) / 1000).toISOString();

    case DuckDBTypeId.TIMESTAMP_MS:
      return new Date(Number(value.milliseconds)).toISOString();

    case DuckDBTypeId.TIMESTAMP_S:
      return new Date(Number(value.seconds) * 1000).toISOString();

    case DuckDBTypeId.TIMESTAMP_NS:
      return new Date(Number(value.nanoseconds) / 1000000).toISOString();

    case DuckDBTypeId.TIME:
    case DuckDBTypeId.TIME_TZ:
      return value.toString();

    case DuckDBTypeId.ARRAY:
    case DuckDBTypeId.LIST:
      return JSON.stringify(value);

    case DuckDBTypeId.STRUCT:
      return JSON.stringify(value);

    case DuckDBTypeId.MAP:
      return JSON.stringify(value);

    case DuckDBTypeId.DECIMAL:
      return value.toDouble();

    case DuckDBTypeId.UUID:
      return value.toString();

    case DuckDBTypeId.INTERVAL:
      return value.toString();

    case DuckDBTypeId.BLOB:
      return value.toString();

    case DuckDBTypeId.BIT:
      return value.toBools();

    case DuckDBTypeId.UNION:
      return JSON.stringify(value);

    default:
      return value;
  }
};

const app = express();
app.use(cors());
app.use(express.json());

// Initialize DuckDB
const instance = await duckdb.DuckDBInstance.create(db);
const connection = await instance.connect();
connection.run("INSTALL nanoarrow FROM community; LOAD nanoarrow;");

// Query endpoint
app.post("/query", async (req, res) => {
  try {
    const { query, withColumns = false } = req.body;
    logger.info({ message: "Processing query request", query });
    const connection = await instance.connect();
    const result = await connection.run(query);
    const rawData = await result.getRowObjectsJson();
    const columnTypes = await result.columnNameAndTypeObjectsJson();

    const processedData = rawData.map((row) => {
      const processedRow = {};
      for (const [key, value] of Object.entries(row)) {
        const columnType = columnTypes.find((col) => col.name === key);
        processedRow[key] = convertDuckDBValue(value, columnType?.typeId);
      }
      return processedRow;
    });
    connection.closeSync();
    res.json({
      result: processedData,
      columns: withColumns ? columnTypes : [],
    });
  } catch (error) {
    logger.error({
      message: "DuckDB Error",
      error: error.message,
      stack: error.stack,
    });
    connection?.closeSync();
    res.status(400).json({
      error: error.message,
    });
  }
});

// DuckDB version endpoint
app.get("/duckdb", (req, res) => {
  res.json({
    version: duckdb.version(),
  });
});

// Describe endpoint
app.post("/describe", async (req, res) => {
  const { query } = req.body;
  const connection = await instance.connect();
  const result = await connection.run(query);
  res.json(result.columnNameAndTypeObjectsJson());
});

// Stream endpoint
app.post("/stream", async (req, res) => {
  try {
    const { query, bufferSize = 100000 } = req.body;
    console.log(query);
    logger.info({ message: "Processing stream request" });
    const connection = await instance.connect();
    let reader = await connection.streamAndReadAll(query);
    const columnTypes = (await reader.columnNameAndTypeObjectsJson()).reduce(
      (acc, col) => {
        acc[col.columnName] = col.columnType.typeId;
        return acc;
      },
      {}
    );
    const _dedupedColumnNames = reader.deduplicatedColumnNames();

    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Content-Type", "application/json");

    for (const chunk of reader.chunks) {
      const rows = chunk.getRowObjects(_dedupedColumnNames);
      if (rows.length > 0) {
        const processedRows = rows.map((row) => {
          const processedRow = {};
          for (const [key, value] of Object.entries(row)) {
            const columnType = columnTypes[key];
            processedRow[key] = convertDuckDBValue(value, columnType);
          }
          return processedRow;
        });
        res.write(JSON.stringify(processedRows) + "\n");
      }
    }

    res.end();
    connection.closeSync();
  } catch (error) {
    logger.error({
      message: "Error in stream endpoint",
      error: error.message,
      stack: error.stack,
    });
    res.status(400).json({
      error: error.message,
    });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, "../public/quackbook")));

// Start server
app.listen(port, () => {
  const address = `http://${host}:${port}`;
  logger.info({
    message: `Go to ${address}/#/?quackMode=true&serverPort=${port}`,
  });
  if (openBrowser) {
    open(`${address}/#/?quackMode=true&serverPort=${port}`);
  }
});
