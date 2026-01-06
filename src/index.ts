import { createConnection } from "mysql2/promise";

// 定义环境变量接口
interface Env {
  HYPERDRIVE: {
    host: string;
    user: string;
    password: string;
    database: string;
    port: number;
  };
  JWT_SECRET: string; // JWT 密钥
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // 用户注册
      if (path === "/api/register" && method === "POST") {
        return await registerUser(request, env);
      }

      // 用户登录
      if (path === "/api/login" && method === "POST") {
        return await loginUser(request, env);
      }

      // 默认返回 404
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

// 使用 Web Crypto API 进行密码哈希加密
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 使用 Web Crypto API 生成 JWT
async function generateJWT(payload: object, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };

  const base64UrlEncode = (obj: object): string => {
    return btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode({ ...payload, exp: Date.now() + 3600 * 1000 }); // 设置过期时间为 1 小时

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signatureInput));
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signature = signatureArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// 使用 Web Crypto API 验证 JWT
async function verifyJWT(token: string, secret: string): Promise<any> {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
    encoder.encode(signatureInput)
  );

  if (!isValid) {
    throw new Error("Invalid token");
  }

  const payload = JSON.parse(atob(encodedPayload));
  if (payload.exp < Date.now()) {
    throw new Error("Token expired");
  }

  return payload;
}

// 用户注册
async function registerUser(request: Request, env: Env): Promise<Response> {
  try {
    // 解析请求体
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response("Missing username or password", { status: 400 });
    }

    // 哈希加密密码
    const passwordHash = await hashPassword(password);

    // 连接数据库
    const connection = await createConnection({
      host: env.HYPERDRIVE.host,
      user: env.HYPERDRIVE.user,
      password: env.HYPERDRIVE.password,
      database: env.HYPERDRIVE.database,
      port: env.HYPERDRIVE.port,
      disableEval: true,
    });

    // 插入用户数据
    const [result] = await connection.execute(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash]
    );

    // 关闭数据库连接
    await connection.end();

    return new Response("User registered successfully", { status: 201 });
  } catch (error) {
    console.error("Error registering user:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// 用户登录
async function loginUser(request: Request, env: Env): Promise<Response> {
  try {
    // 解析请求体
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response("Missing username or password", { status: 400 });
    }

    // 连接数据库
    const connection = await createConnection({
      host: env.HYPERDRIVE.host,
      user: env.HYPERDRIVE.user,
      password: env.HYPERDRIVE.password,
      database: env.HYPERDRIVE.database,
      port: env.HYPERDRIVE.port,
      disableEval: true,
    });

    // 查询用户信息
    const [rows] = await connection.execute(
      "SELECT id, username, password_hash FROM users WHERE username = ?",
      [username]
    );

    // 关闭数据库连接
    await connection.end();

    if (rows.length === 0) {
      return new Response("Invalid username or password", { status: 401 });
    }

    const user = rows[0];

    // 验证密码
    const isPasswordValid = (await hashPassword(password)) === user.password_hash;
    if (!isPasswordValid) {
      return new Response("Invalid username or password", { status: 401 });
    }

    // 生成 JWT
    const token = await generateJWT({ userId: user.id }, env.JWT_SECRET);

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
