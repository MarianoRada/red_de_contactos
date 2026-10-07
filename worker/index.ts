interface Env {
  DB: D1Database;
}

interface ContactRecord {
  id: string;
  name: string;
  description: string;
  email?: string;
  location?: string;
  type: 'person' | 'company' | 'institution';
}

interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
}

interface NodePosition {
  recordId: string;
  x: number;
  y: number;
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      // ==========================================
      // RECORDS
      // ==========================================

      // GET /api/records
      if (
        request.method === 'GET' &&
        url.pathname === '/api/records'
      ) {
        const { results } = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              description,
              email,
              location,
              type
            FROM records
            ORDER BY name ASC
          `)
          .all();

        return json(results);
      }

      // POST /api/records
      if (
        request.method === 'POST' &&
        url.pathname === '/api/records'
      ) {
        const body = await request.json<ContactRecord>();

        if (!body.id || !body.name || !body.type) {
          return json(
            { error: 'id, name y type son obligatorios' },
            400
          );
        }

        if (
          !['person', 'company', 'institution'].includes(body.type)
        ) {
          return json(
            { error: 'Tipo de registro inválido' },
            400
          );
        }

        await env.DB
          .prepare(`
            INSERT INTO records (
              id,
              name,
              description,
              email,
              location,
              type
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            body.id,
            body.name,
            body.description ?? '',
            body.email ?? null,
            body.location ?? null,
            body.type
          )
          .run();

        return json(body, 201);
      }

      const recordMatch = url.pathname.match(
        /^\/api\/records\/([^/]+)$/
      );

      // PUT /api/records/:id
      if (
        request.method === 'PUT' &&
        recordMatch
      ) {
        const id = decodeURIComponent(recordMatch[1]);
        const body = await request.json<ContactRecord>();

        if (!body.name || !body.type) {
          return json(
            { error: 'name y type son obligatorios' },
            400
          );
        }

        if (
          !['person', 'company', 'institution'].includes(body.type)
        ) {
          return json(
            { error: 'Tipo de registro inválido' },
            400
          );
        }

        const result = await env.DB
          .prepare(`
            UPDATE records
            SET
              name = ?,
              description = ?,
              email = ?,
              location = ?,
              type = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(
            body.name,
            body.description ?? '',
            body.email ?? null,
            body.location ?? null,
            body.type,
            id
          )
          .run();

        if (result.meta.changes === 0) {
          return json(
            { error: 'Registro no encontrado' },
            404
          );
        }

        return json({
          ...body,
          id,
        });
      }

      // DELETE /api/records/:id
      if (
        request.method === 'DELETE' &&
        recordMatch
      ) {
        const id = decodeURIComponent(recordMatch[1]);

        const result = await env.DB
          .prepare(`
            DELETE FROM records
            WHERE id = ?
          `)
          .bind(id)
          .run();

        if (result.meta.changes === 0) {
          return json(
            { error: 'Registro no encontrado' },
            404
          );
        }

        return json({
          success: true,
          id,
        });
      }

      // ==========================================
      // RELATIONSHIPS
      // ==========================================

      // GET /api/relationships
      if (
        request.method === 'GET' &&
        url.pathname === '/api/relationships'
      ) {
        const { results } = await env.DB
          .prepare(`
            SELECT
              id,
              source_id AS sourceId,
              target_id AS targetId,
              type
            FROM relationships
          `)
          .all();

        return json(results);
      }

      // POST /api/relationships
      if (
        request.method === 'POST' &&
        url.pathname === '/api/relationships'
      ) {
        const body = await request.json<Relationship>();

        if (
          !body.id ||
          !body.sourceId ||
          !body.targetId ||
          !body.type
        ) {
          return json(
            {
              error:
                'id, sourceId, targetId y type son obligatorios',
            },
            400
          );
        }

        await env.DB
          .prepare(`
            INSERT INTO relationships (
              id,
              source_id,
              target_id,
              type
            )
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            body.id,
            body.sourceId,
            body.targetId,
            body.type
          )
          .run();

        return json(body, 201);
      }

      const relationshipMatch = url.pathname.match(
        /^\/api\/relationships\/([^/]+)$/
      );

      // PUT /api/relationships/:id
      if (
        request.method === 'PUT' &&
        relationshipMatch
      ) {
        const id = decodeURIComponent(
          relationshipMatch[1]
        );

        const body =
          await request.json<Relationship>();

        if (
          !body.sourceId ||
          !body.targetId ||
          !body.type
        ) {
          return json(
            {
              error:
                'sourceId, targetId y type son obligatorios',
            },
            400
          );
        }

        const result = await env.DB
          .prepare(`
            UPDATE relationships
            SET
              source_id = ?,
              target_id = ?,
              type = ?
            WHERE id = ?
          `)
          .bind(
            body.sourceId,
            body.targetId,
            body.type,
            id
          )
          .run();

        if (result.meta.changes === 0) {
          return json(
            { error: 'Relación no encontrada' },
            404
          );
        }

        return json({
          ...body,
          id,
        });
      }

      // DELETE /api/relationships/:id
      if (
        request.method === 'DELETE' &&
        relationshipMatch
      ) {
        const id = decodeURIComponent(
          relationshipMatch[1]
        );

        const result = await env.DB
          .prepare(`
            DELETE FROM relationships
            WHERE id = ?
          `)
          .bind(id)
          .run();

        if (result.meta.changes === 0) {
          return json(
            { error: 'Relación no encontrada' },
            404
          );
        }

        return json({
          success: true,
          id,
        });
      }

      // ==========================================
      // NODE POSITIONS
      // ==========================================

      // GET /api/node-positions
      if (
        request.method === 'GET' &&
        url.pathname === '/api/node-positions'
      ) {
        const { results } = await env.DB
          .prepare(`
            SELECT
              record_id AS recordId,
              x,
              y
            FROM node_positions
          `)
          .all<NodePosition>();

        return json(results);
      }

      const nodePositionMatch = url.pathname.match(
        /^\/api\/node-positions\/([^/]+)$/
      );

      // PUT /api/node-positions/:recordId
      //
      // Hace UPSERT:
      // - si la posición no existe, la crea
      // - si ya existe, la actualiza
      if (
        request.method === 'PUT' &&
        nodePositionMatch
      ) {
        const recordId = decodeURIComponent(
          nodePositionMatch[1]
        );

        const body = await request.json<{
          x: number;
          y: number;
        }>();

        if (
          !Number.isFinite(body.x) ||
          !Number.isFinite(body.y)
        ) {
          return json(
            { error: 'x e y deben ser números válidos' },
            400
          );
        }

        await env.DB
          .prepare(`
            INSERT INTO node_positions (
              record_id,
              x,
              y
            )
            VALUES (?, ?, ?)
            ON CONFLICT(record_id)
            DO UPDATE SET
              x = excluded.x,
              y = excluded.y
          `)
          .bind(
            recordId,
            body.x,
            body.y
          )
          .run();

        return json({
          recordId,
          x: body.x,
          y: body.y,
        });
      }

      // ==========================================
      // NOT FOUND
      // ==========================================

      return json(
        { error: 'Not found' },
        404
      );
    } catch (error) {
      console.error(error);

      return json(
        { error: 'Internal server error' },
        500
      );
    }
  },
};