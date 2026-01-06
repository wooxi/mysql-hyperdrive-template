import { createConnection } from "mysql2/promise";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

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
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return new Response("Invalid username or password", { status: 401 });
    }

    // 生成 JWT
    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: "1h" });

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
