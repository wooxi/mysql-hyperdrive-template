import { createConnection } from "mysql2/promise";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // Create a connection using the mysql2 driver with the Hyperdrive credentials
    const connection = await createConnection({
      host: env.HYPERDRIVE.host,
      user: env.HYPERDRIVE.user,
      password: env.HYPERDRIVE.password,
      database: env.HYPERDRIVE.database,
      port: env.HYPERDRIVE.port,

      // Required to enable mysql2 compatibility for Workers
      disableEval: true,
    });

    try {
      // Sample query
      const [results, fields] = await connection.query("SHOW tables;");

      // Clean up the client after the response is returned, before the Worker is killed
      ctx.waitUntil(connection.end());

      // Return result rows as JSON
      return Response.json({ results, fields });
    } catch (e) {
      console.error(e);
    }
  },
}
