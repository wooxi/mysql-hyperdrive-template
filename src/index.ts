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
}

// 内存缓存，用于存储已处理的 CallSheetID
const processedRequests = new Map();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // 检查路径和方法
      if (path !== "/save" || method !== "GET") {
        return new Response("Invalid request method or path", {
          status: 405,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // 解析查询参数
      const queryParams = Object.fromEntries(url.searchParams.entries());

      // 获取唯一标识符 CallSheetID
      const callSheetID = queryParams.CallSheetID;
      if (!callSheetID) {
        return new Response("Missing CallSheetID", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // 检查是否为重复请求
      if (processedRequests.has(callSheetID)) {
        console.log(`Duplicate request detected for CallSheetID: ${callSheetID}`);
        return new Response("success", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // 标记为已处理，并设置过期时间（例如 5 分钟）
      processedRequests.set(callSheetID, true);
      setTimeout(() => processedRequests.delete(callSheetID), 5 * 60 * 1000);

      // 异步存储数据到 MySQL（通过 Hyperdrive）
      ctx.waitUntil(saveToDatabase(queryParams, env));

      // 立即返回字符串 "success"
      return new Response("success", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
};

// 存储数据到 MySQL（通过 Hyperdrive）
async function saveToDatabase(data: Record<string, string>, env: Env) {
  let connection;
  try {
    // 使用 Hyperdrive 连接 MySQL
    connection = await createConnection({
      host: env.HYPERDRIVE.host,
      user: env.HYPERDRIVE.user,
      password: env.HYPERDRIVE.password,
      database: env.HYPERDRIVE.database,
      port: env.HYPERDRIVE.port,
      disableEval: true, // 必须启用以支持 Workers 兼容性
    });

    const callSheetID = data.CallSheetID;
    const jsonData = JSON.stringify(data);

    // 插入数据到指定表（使用普通 SQL 查询代替预处理语句）
    const tableName = "CallSheetData"; // 表名固定
    const query = `
      INSERT INTO ${tableName} (CallSheetID, Data)
      VALUES ('${callSheetID}', '${jsonData}')
      ON DUPLICATE KEY UPDATE Data = VALUES(Data)
    `;
    await connection.query(query);
  } catch (error) {
    console.error("Error saving data to MySQL:", error);
  } finally {
    // 确保连接关闭
    if (connection) {
      await connection.end();
    }
  }
}
