#!/usr/bin/env node
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { timing } from "hono/timing";
import { requestId } from "hono/request-id";
import duckdb, { version } from "@duckdb/node-api";
import arg from "arg";
import { stream } from "hono/streaming";
import { DuckDBTypeId } from "@duckdb/node-api";
import winston from "winston";
import open from "open";
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
      // return value.items.map((item) => convertDuckDBValue(item, item.typeId));
      return JSON.stringify(value);

    case DuckDBTypeId.STRUCT:
      // return Object.fromEntries(
      //   value.entries.map(([key, val]) => [key, convertDuckDBValue(val, val.typeId)])
      // );
      return JSON.stringify(value);

    case DuckDBTypeId.MAP:
      // return Object.fromEntries(
      //   value.entries.map(({ key, value: val }) => [
      //     convertDuckDBValue(key, key.typeId),
      //     convertDuckDBValue(val, val.typeId),
      //   ])
      // );
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
      // return {
      //   tag: value.tag,
      //   value: convertDuckDBValue(value.value, value.value.typeId),
      // };
      return JSON.stringify(value);

    default:
      return value;
  }
};

const app = new Hono();

app.use("*", cors());
app.use("*", timing());
app.use("*", requestId());

const args = arg({
  "--port": Number,
  "--host": String,
  "--db": String,
  "--open": Boolean,
});

const port = args["--port"] || 3000;
const host = args["--host"] || "0.0.0.0";
const db = args["--db"] || ":memory:";
const openBrowser = args["--open"] || false;
const instance = await duckdb.DuckDBInstance.create(db);
const connection = await instance.connect();
connection.run("INSTALL nanoarrow FROM community; LOAD nanoarrow;");
// /query endpoint - returns a simple response
app.post("/query", async (c) => {
  try {
    const { query, withColumns = false } = await c.req.json();
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
    return c.json({
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
    return c.json(
      {
        error: error.message,
      },
      400
    );
  }
});

app.get("/duckdb", async (c) => {
  return {
    version: duckdb.version(),
  };
});

app.post("/describe", async (c) => {
  const { query } = await c.req.json();
  const connection = await instance.connect();
  const result = await connection.run(query);
  return result.columnNameAndTypeObjectsJson();
});

app.post("/stream", async (c) => {
  try {
    const { query, bufferSize = 100000 } = await c.req.json();
    logger.info({ message: "Processing stream request", query });
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

    c.header("Transfer-Encoding", "chunked");
    c.header("Content-Type", "application/json");
    return stream(c, async (stream) => {
      try {
        stream.onAbort((e) => {
          logger.warn({ message: "Stream aborted", error: e });
          connection.closeSync();
        });

        let currentBatch = 0;
        const batchSize = 100000;
        for (const chunk of reader.chunks) {
          logger.debug({
            message: "Processing chunk",
            chunkNumber: currentBatch,
          });
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
            await stream.write(JSON.stringify(processedRows) + "\n");
          }

          logger.debug({
            message: "Stream progress",
            done: reader.done_,
            currentRowCount: reader.currentRowCount,
          });
        }
      } catch (error) {
        logger.error({
          message: "Error during streaming",
          error: error.message,
          stack: error.stack,
        });
        connection?.closeSync();
        throw error;
      } finally {
        connection.closeSync();
      }
    });
  } catch (error) {
    logger.error({
      message: "Error in stream endpoint",
      error: error.message,
      stack: error.stack,
    });
    return c.json(
      {
        error: error.message,
      },
      400
    );
  }
});

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    const address = `http://${host}:${port}`;
    logger.info({ message: `Server is running on ${address}` });
    if (openBrowser) {
      open(`http://${host}:${port}`);
    }
  }
);
