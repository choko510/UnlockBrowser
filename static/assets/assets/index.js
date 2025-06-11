import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import fetch from "node-fetch";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import config from "./config.js";

console.log(chalk.yellow("🚀 Starting server..."));

const __dirname = process.cwd();
const server = http.createServer();
const app = express();
const bareServer = createBareServer("/ca/");
const PORT = process.env.PORT || 8080;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // Cache for 30 Days

// Gemini AI の初期化
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Multer の設定（メモリに画像を保存）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB制限
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('画像ファイルのみアップロード可能です'), false);
    }
  }
});

if (config.challenge !== false) {
  console.log(
    chalk.green("🔒 Password protection is enabled! Listing logins below"),
  );
  // biome-ignore lint/complexity/noForEach:
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp > CACHE_TTL) {
        cache.delete(req.path);
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
    }

    const baseUrls = {
      "/e/1/": "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/": "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/": "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget;
    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget = baseUrl + req.path.slice(prefix.length);
        break;
      }
    }

    if (!reqTarget) {
      return next();
    }

    const asset = await fetch(reqTarget);
    if (!asset.ok) {
      return next();
    }

    const data = Buffer.from(await asset.arrayBuffer());
    const ext = path.extname(reqTarget);
    const no = [".unityweb"];
    const contentType = no.includes(ext)
      ? "application/octet-stream"
      : mime.getType(ext);

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* if (process.env.MASQR === "true") {
  console.log(chalk.green("Masqr is enabled"));
  setupMasqr(app);
} */

app.use(express.static(path.join(__dirname, "static")));
app.use("/ca", cors({ origin: true }));

// API エンドポイント
app.use("/api", cors({ origin: true }));

// API ルート - 画像解析
app.post("/api/aireq", upload.single('image'), async (req, res) => {
  try {
    // 画像ファイルの確認
    if (!req.file) {
      return res.status(400).json({ error: "画像ファイルが必要です" });
    }

    // プロンプトの取得（オプション）
    const prompt = req.body.prompt || "この画像について詳しく説明してください";

    // ストリーミングレスポンスのヘッダー設定
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 画像データを Base64 に変換
    const imageData = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype
      }
    };

    // Gemini Pro Vision モデルを取得
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // ストリーミングで生成開始
    const result = await model.generateContentStream([prompt, imageData]);

    // ストリーミングレスポンスを処理
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        res.write(chunkText);
      }
    }

    // ストリーミング終了
    res.end();

  } catch (error) {
    console.error("Gemini API エラー:", error);
    
    // エラーレスポンス
    if (!res.headersSent) {
      res.status(500).json({
        error: "画像解析中にエラーが発生しました",
        details: error.message
      });
    } else {
      res.write("\n\n[エラー: 画像解析中に問題が発生しました]");
      res.end();
    }
  }
});

// API ルート - テキストのみの質問
app.post("/api/text", async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "メッセージが必要です" });
    }

    // ストリーミングレスポンスのヘッダー設定
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Gemini Pro モデルを取得
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // ストリーミングで生成開始
    const result = await model.generateContentStream(message);

    // ストリーミングレスポンスを処理
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        res.write(chunkText);
      }
    }

    // ストリーミング終了
    res.end();

  } catch (error) {
    console.error("Gemini API エラー:", error);
    
    // エラーレスポンス
    if (!res.headersSent) {
      res.status(500).json({
        error: "テキスト処理中にエラーが発生しました",
        details: error.message
      });
    } else {
      res.write("\n\n[エラー: テキスト処理中に問題が発生しました]");
      res.end();
    }
  }
});

// API エラーハンドリング
app.use("/api/*", (req, res) => {
  console.log(chalk.red(`🚫 404 Not Found: ${req.method} ${req.path}`));
  res.status(404).json({
    error: "APIエンドポイントが見つかりません",
    path: req.path,
    method: req.method,
    availableEndpoints: [
      "POST /api/aireq - 画像解析（画像ファイルとオプションのプロンプトを送信）",
      "POST /api/text - テキストのみの質問（JSONで{\"message\": \"質問内容\"}を送信）"
    ]
  });
});

const routes = [
  { path: "/", file: "index.html" },
];

// biome-ignore lint/complexity/noForEach:
routes.forEach(route => {
  app.get(route.path, (_req, res) => {
    res.sendFile(path.join(__dirname, "static", route.file));
  });
});

app.use((req, res, next) => {
  console.log(
    chalk.yellow(`🚫 404 Not Found: ${req.method} ${req.url}`),
  );
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "static", "404.html"));
});

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("listening", () => {
  console.log(chalk.green(`🌍 Server is running on http://localhost:${PORT}`));
});

server.listen({ port: PORT });
