import { createConnection } from "mysql2/promise";
import * as XLSX from "xlsx";

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

      // 处理文件上传和数据导入
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
    // 解析请求体（获取上传的文件）
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response("Missing file", { status: 400 });
    }

    // 读取 Excel 文件
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = workbook.SheetNames[0]; // 假设只处理第一个工作表
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // 检查表头是否包含必填字段
    const requiredFields = [
      "主叫号码",
      "被叫号码",
      "呼叫类型",
      "呼叫时间",
      "坐席通话时间",
      "部门",
      "接听坐席",
      "工号",
      "接听状态",
      "呼入技能组",
      "终结节点",
      "按键轨迹",
      "省",
      "市",
      "通话ID",
      "PBX名称",
    ];

    const headers = jsonData[0] as string[];
    for (const field of requiredFields) {
      if (!headers.includes(field)) {
        return new Response(`Missing required field: ${field}`, { status: 400 });
      }
    }

    // 构建字段映射规则
    const fieldMapping = {
      主叫号码: "caller_number",
      被叫号码: "callee_number",
      呼叫类型: "call_type",
      呼叫时间: "call_time",
      坐席通话时间: "agent_call_time",
      部门: "department",
      接听坐席: "agent_name",
      工号: "agent_id",
      接听状态: "call_status",
      呼入技能组: "skill_group",
      终结节点: "end_node",
      按键轨迹: "key_track",
      省: "province",
      市: "city",
      通话ID: "call_id",
      PBX名称: "pbx_name",
    };

    // 转换数据格式
    const rows = jsonData.slice(1).map((row) => {
      const rowData: Record<string, string> = {};
      row.forEach((value, index) => {
        const fieldName = headers[index];
        const mappedField = fieldMapping[fieldName];
        if (mappedField) {
          rowData[mappedField] = String(value || "");
        }
      });
      return rowData;
    });

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
