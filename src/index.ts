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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // 处理数据导入
      if (path === "/api/import" && method === "POST") {
        return await importData(request, env);
      }

      // 默认返回 404
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

// 导入数据
async function importData(request: Request, env: Env): Promise<Response> {
  try {
    // 解析请求体（获取 JSON 数据）
    const body = await request.json();
    const rows = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response("Missing or invalid data", { status: 400 });
    }

    // 检查必填字段
    const requiredFields = [
      "call_id",
      "caller_number",
      "callee_number",
      "call_type",
      "call_time",
      "agent_call_time",
      "department",
      "agent_name",
      "agent_id",
      "call_status",
      "skill_group",
      "end_node",
      "key_track",
      "province",
      "city",
      "pbx_name",
    ];

    for (const row of rows) {
      for (const field of requiredFields) {
        if (!(field in row)) {
          return new Response(`Missing required field: ${field}`, { status: 400 });
        }
      }
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

    // 开始事务
    await connection.beginTransaction();

    try {
      // 批量插入数据
      const tableName = "mxbc_call"; // 目标表名
      const batchSize = 1000; // 每批次插入 1000 行
      let successCount = 0;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values = batch.map((row) => [
          row.call_id,
          row.caller_number,
          row.callee_number,
          row.call_type,
          row.call_time,
          row.agent_call_time,
          row.department,
          row.agent_name,
          row.agent_id,
          row.call_status,
          row.skill_group,
          row.end_node,
          row.key_track,
          row.province,
          row.city,
          row.pbx_name,
        ]);

        const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        const query = `
          INSERT INTO ${tableName} (
            call_id, caller_number, callee_number, call_type, call_time, agent_call_time,
            department, agent_name, agent_id, call_status, skill_group, end_node,
            key_track, province, city, pbx_name
          ) VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE call_id = VALUES(call_id)
        `;

        const flattenedValues = values.flat();
        await connection.query(query, flattenedValues);
        successCount += batch.length;
      }

      // 提交事务
      await connection.commit();

      // 记录日志
      const logQuery = `
        INSERT INTO import_logs (table_name, rows_imported, status)
        VALUES (?, ?, ?)
      `;
      await connection.execute(logQuery, [tableName, successCount, "success"]);

      return new Response(`Successfully imported ${successCount} rows`, { status: 200 });
    } catch (error) {
      // 回滚事务
      await connection.rollback();
      console.error("Error importing data:", error);

      // 记录失败日志
      const logQuery = `
        INSERT INTO import_logs (table_name, rows_imported, status, error_message)
        VALUES (?, ?, ?, ?)
      `;
      await connection.execute(logQuery, ["mxbc_call", 0, "failed", String(error)]);

      return new Response("Failed to import data", { status: 500 });
    } finally {
      // 关闭数据库连接
      await connection.end();
    }
  } catch (error) {
    console.error("Error handling file upload:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
