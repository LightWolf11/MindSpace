"use strict";

require("./config").loadEnvironment();

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const path = require("node:path");
const nodeFs = require("node:fs");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const multer = require("multer");

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const avatarDirectory = path.join(__dirname, "uploads", "avatars");
const errorPageTemplate = nodeFs.readFileSync(path.join(__dirname, "error.html"), "utf8");
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "mindspace",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z"
});

const statuses = new Set(["backlog", "todo", "progress", "review", "done"]);
const priorities = new Set(["low", "medium", "high", "critical"]);
const startedStatuses = new Set(["progress", "review", "done"]);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/uploads/avatars", express.static(avatarDirectory, {
  fallthrough: false,
  maxAge: "1d"
}));
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
  if (req.body === undefined) {
    req.body = {};
  } else if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return next(apiError(400, "VALIDATION_ERROR", "Тело запроса должно быть JSON-объектом."));
  }
  return next();
});

const russianErrorMessages = new Map([
  ["Request body must be a JSON object.", "Тело запроса должно быть JSON-объектом."],
  ["Request validation failed.", "Проверьте корректность заполнения полей."],
  ["Must be a string.", "Значение должно быть строкой."],
  ["Must be a six-digit hexadecimal color.", "Укажите цвет в формате HEX, например #5c1f2d."],
  ["Must be a valid project id.", "Выберите корректный проект."],
  ["Unsupported priority.", "Выберите допустимый приоритет."],
  ["Unsupported status.", "Выберите допустимый статус."],
  ["Must be a valid date in YYYY-MM-DD format or null.", "Укажите корректную дату в формате ГГГГ-ММ-ДД."],
  ["Must be an array of unique task ids.", "Укажите список задач без повторов."],
  ["Must be an array of unique tags up to 40 characters each.", "Метки должны быть уникальными и содержать не более 40 символов."],
  ["Authorization header is required.", "Для доступа необходимо войти в аккаунт."],
  ["Token is not linked to a session.", "Токен не связан с активной сессией."],
  ["Session has expired or been revoked.", "Сессия истекла или была завершена."],
  ["Token is invalid or expired.", "Токен недействителен или истёк."],
  ["Project not found.", "Проект не найден."],
  ["Only the project owner can manage this project.", "Управлять проектом может только его владелец."],
  ["You have view-only access to this project.", "У вас есть только право просмотра этого проекта."],
  ["Task not found.", "Задача не найдена."],
  ["A task cannot depend on itself.", "Задача не может зависеть от самой себя."],
  ["Every dependency must belong to your account.", "Все связанные задачи должны быть доступны вам."],
  ["This dependency would create a cycle.", "Эта зависимость создаст замкнутый цикл."],
  ["MySQL is unavailable. Start the MySQL service and check the database settings in .env.", "База данных временно недоступна. Проверьте настройки подключения."],
  ["Enter a valid email address.", "Введите корректный адрес электронной почты."],
  ["Password must contain at least 8 characters and no more than 72 UTF-8 bytes.", "Пароль должен содержать не менее 8 символов и занимать не более 72 байт в UTF-8."],
  ["Email and password are required.", "Введите адрес электронной почты и пароль."],
  ["Required.", "Обязательное поле."],
  ["Email or password is incorrect.", "Неверный адрес электронной почты или пароль."],
  ["Avatar image must be 2 MB or smaller.", "Размер изображения не должен превышать 2 МБ."],
  ["Upload one PNG, JPEG, or WebP image.", "Загрузите одно изображение в формате PNG, JPEG или WebP."],
  ["Upload a valid PNG, JPEG, or WebP image.", "Загрузите корректное изображение в формате PNG, JPEG или WebP."],
  ["Current password is required.", "Введите текущий пароль."],
  ["Current password is incorrect.", "Текущий пароль указан неверно."],
  ["Choose a password different from the current one.", "Новый пароль должен отличаться от текущего."],
  ["New password must be different.", "Новый пароль должен отличаться от текущего."],
  ["Password changed. Other active sessions were signed out.", "Пароль изменён. Остальные активные сеансы завершены."],
  ["Session closed.", "Сеанс завершён."],
  ["Account no longer exists.", "Аккаунт больше не существует."],
  ["Session id must be a UUID.", "Идентификатор сеанса должен иметь формат UUID."],
  ["Active session not found.", "Активный сеанс не найден."],
  ["Provide at least one field.", "Укажите хотя бы одно поле для изменения."],
  ["Delete or move the project's tasks before deleting it.", "Перед удалением проекта удалите или перенесите его задачи."],
  ["The project owner is already a member.", "Владелец уже является участником проекта."],
  ["No account is registered with this email address.", "Аккаунт с таким адресом электронной почты не найден."],
  ["This user is already a project member.", "Этот пользователь уже участвует в проекте."],
  ["Choose editor or viewer access.", "Выберите права «Редактирование» или «Только просмотр»."],
  ["Unsupported role.", "Выберите допустимую роль участника."],
  ["Project member not found.", "Участник проекта не найден."],
  ["Choose accept or decline.", "Выберите: принять или отклонить."],
  ["Unsupported response.", "Недопустимый ответ на приглашение."],
  ["Invitation not found or already answered.", "Приглашение не найдено или на него уже ответили."],
  ["Task has unfinished dependencies.", "Нельзя начать задачу, пока не завершены её зависимости."],
  ["Choose a supported task status.", "Выберите допустимый статус задачи."],
  ["API route not found.", "Маршрут API не найден."],
  ["Request body contains invalid JSON.", "Тело запроса содержит некорректный JSON."],
  ["A record with this value already exists.", "Запись с таким значением уже существует."],
  ["An unexpected server error occurred.", "На сервере произошла непредвиденная ошибка."]
]);

function translateErrorMessage(message) {
  if (russianErrorMessages.has(message)) return russianErrorMessages.get(message);
  const lengthMatch = /^Must contain between (\d+) and (\d+) characters\.$/.exec(message);
  if (lengthMatch) return `Длина должна быть от ${lengthMatch[1]} до ${lengthMatch[2]} символов.`;
  const idMatch = /^(Project|Task|User|Invitation) id must be a positive integer\.$/.exec(message);
  if (idMatch) {
    const labels = { Project: "проекта", Task: "задачи", User: "пользователя", Invitation: "приглашения" };
    return `Идентификатор ${labels[idMatch[1]]} должен быть положительным целым числом.`;
  }
  const estimateMatch = /^Must be a number between (\d+) and (\d+)\.$/.exec(message);
  if (estimateMatch) return `Укажите число от ${estimateMatch[1]} до ${estimateMatch[2]}.`;
  return message;
}

function translateErrorDetails(details) {
  if (Array.isArray(details)) return details.map(translateErrorDetails);
  if (!details || typeof details !== "object") {
    return typeof details === "string" ? translateErrorMessage(details) : details;
  }
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    translateErrorDetails(value)
  ]));
}

function apiError(status, code, message, details) {
  const codeMessages = {
    AUTH_REQUIRED: "Для доступа необходимо войти в аккаунт.",
    INVALID_TOKEN: "Токен недействителен или истёк.",
    SESSION_REVOKED: "Сессия истекла или была завершена.",
    DATABASE_UNAVAILABLE: "База данных временно недоступна. Проверьте настройки подключения."
  };
  const error = new Error(codeMessages[code] || translateErrorMessage(message));
  error.status = status;
  error.code = code;
  if (details) error.details = translateErrorDetails(details);
  return error;
}

function asyncRoute(handler) {
  return function wrappedRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function validateString(value, field, min, max, errors, required) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    errors[field] = "Значение должно быть строкой.";
    return undefined;
  }
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length < min || normalized.length > max) {
    errors[field] = `Длина должна быть от ${min} до ${max} символов.`;
    return normalized;
  }
  return normalized;
}

function sendValidationErrors(errors) {
  if (Object.keys(errors).length) {
    throw apiError(400, "VALIDATION_ERROR", "Проверьте корректность заполнения полей.", errors);
  }
}

function validateProject(body, partial) {
  const errors = {};
  const data = {};
  const name = validateString(body.name, "name", 2, 80, errors, !partial);
  if (name !== undefined) data.name = name;
  if (body.color !== undefined || !partial) {
    const color = body.color === undefined ? "#5c1f2d" : body.color;
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      errors.color = "Укажите цвет в формате HEX, например #5c1f2d.";
    } else {
      data.color = color.toLowerCase();
    }
  }
  sendValidationErrors(errors);
  return data;
}

function validateTask(body, partial) {
  const errors = {};
  const data = {};
  const title = validateString(body.title, "title", 3, 90, errors, !partial);
  const description = validateString(body.description === undefined && !partial ? "" : body.description,
    "description", 0, 5000, errors, false);
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;

  if (body.projectId !== undefined || !partial) {
    const projectId = Number(body.projectId);
    if (!Number.isSafeInteger(projectId) || projectId < 1) errors.projectId = "Выберите корректный проект.";
    else data.projectId = projectId;
  }
  if (body.priority !== undefined || !partial) {
    const priority = body.priority === undefined ? "medium" : body.priority;
    if (!priorities.has(priority)) errors.priority = "Выберите допустимый приоритет.";
    else data.priority = priority;
  }
  if (body.status !== undefined || !partial) {
    const status = body.status === undefined ? "todo" : body.status;
    if (!statuses.has(status)) errors.status = "Выберите допустимый статус.";
    else data.status = status;
  }
  if (body.dueDate !== undefined || !partial) {
    const dueDate = body.dueDate === undefined || body.dueDate === "" ? null : body.dueDate;
    if (dueDate !== null && (typeof dueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
        Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)) ||
        new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate)) {
      errors.dueDate = "Укажите корректную дату в формате ГГГГ-ММ-ДД.";
    } else {
      data.dueDate = dueDate;
    }
  }
  if (body.estimate !== undefined || !partial) {
    const estimate = body.estimate === undefined ? 0 : Number(body.estimate);
    if (!Number.isFinite(estimate) || estimate < 0 || estimate > 200) {
      errors.estimate = "Укажите число от 0 до 200.";
    } else {
      data.estimate = estimate;
    }
  }
  if (body.dependsOn !== undefined || !partial) {
    const dependsOn = body.dependsOn === undefined ? [] : body.dependsOn;
    if (!Array.isArray(dependsOn) ||
        dependsOn.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1) ||
        new Set(dependsOn.map(Number)).size !== dependsOn.length) {
      errors.dependsOn = "Укажите список задач без повторов.";
    } else {
      data.dependsOn = dependsOn.map(Number);
    }
  }
  if (body.tags !== undefined || !partial) {
    const tags = body.tags === undefined ? [] : body.tags;
    if (!Array.isArray(tags) || tags.some((tag) =>
      typeof tag !== "string" || tag.trim().length < 1 || tag.trim().length > 40) ||
      (Array.isArray(tags) && new Set(tags.map((tag) => tag.trim().toLowerCase())).size !== tags.length)) {
      errors.tags = "Метки должны быть уникальными и содержать не более 40 символов.";
    } else {
      data.tags = tags.map((tag) => tag.trim());
    }
  }
  sendValidationErrors(errors);
  return data;
}

async function createSession(user, req) {
  const sessionId = randomUUID();
  const token = jwt.sign({ sub: String(user.id), email: user.email, jti: sessionId }, jwtSecret, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d"
  });
  const payload = jwt.decode(token);
  const expiresAt = new Date(payload.exp * 1000);
  const userAgent = (req.get("user-agent") || "").slice(0, 255) || null;
  await pool.execute(
    `INSERT INTO user_sessions (id, user_id, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, user.id, userAgent, req.ip, expiresAt]
  );
  await pool.execute(
    `DELETE FROM user_sessions
     WHERE expires_at < UTC_TIMESTAMP()
        OR revoked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`
  );
  return { token, session: { id: sessionId, expiresAt: expiresAt.toISOString() } };
}

function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return next(apiError(401, "AUTH_REQUIRED", "Bearer token is required."));
  try {
    const payload = jwt.verify(match[1], jwtSecret);
    if (!payload.jti) return next(apiError(401, "INVALID_TOKEN", "Токен не связан с активной сессией."));
    return pool.execute(
      `SELECT id FROM user_sessions
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
      [payload.jti, Number(payload.sub)]
    ).then(([rows]) => {
      if (!rows.length) return next(apiError(401, "SESSION_REVOKED", "Сессия истекла или была завершена."));
      req.user = { id: Number(payload.sub), email: payload.email, sessionId: payload.jti };
      return next();
    }).catch(next);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return next(apiError(401, "INVALID_TOKEN", "Токен недействителен или истёк."));
    }
    return next(error);
  }
}

function requireId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    const labels = {
      "Project id": "проекта",
      "Task id": "задачи",
      "User id": "пользователя",
      "Invitation id": "приглашения"
    };
    throw apiError(400, "INVALID_ID", `Идентификатор ${labels[label] || label} должен быть положительным целым числом.`);
  }
  return id;
}

async function ownedProject(userId, projectId, connection, ownerOnly, write) {
  const [rows] = await connection.execute(
    `SELECT p.user_id AS ownerId, pm.member_role AS memberRole
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, projectId, userId]
  );
  if (!rows.length) throw apiError(404, "PROJECT_NOT_FOUND", "Проект не найден.");
  const isOwner = Number(rows[0].ownerId) === Number(userId);
  if (ownerOnly && !isOwner) {
    throw apiError(403, "PROJECT_OWNER_REQUIRED", "Управлять проектом может только его владелец.");
  }
  if (write && !isOwner && rows[0].memberRole !== "editor") {
    throw apiError(403, "PROJECT_READ_ONLY", "У вас есть только право просмотра этого проекта.");
  }
  return { role: isOwner ? "owner" : rows[0].memberRole, owner: isOwner };
}

async function ownedTask(userId, taskId, connection, write) {
  const [rows] = await connection.execute(
    `SELECT t.id, t.project_id AS projectId, t.status, p.user_id AS ownerId,
            pm.member_role AS memberRole
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE t.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, taskId, userId]
  );
  if (!rows.length) throw apiError(404, "TASK_NOT_FOUND", "Задача не найдена.");
  const isOwner = Number(rows[0].ownerId) === Number(userId);
  if (write && !isOwner && rows[0].memberRole !== "editor") {
    throw apiError(403, "PROJECT_READ_ONLY", "У вас есть только право просмотра этого проекта.");
  }
  return rows[0];
}

async function ensureOwnedDependencies(userId, taskId, dependencyIds, connection) {
  if (dependencyIds.includes(taskId)) {
    throw apiError(400, "DEPENDENCY_CYCLE", "Задача не может зависеть от самой себя.");
  }
  if (!dependencyIds.length) return;
  const placeholders = dependencyIds.map(() => "?").join(",");
  const [rows] = await connection.execute(
    `SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE (p.user_id = ? OR pm.user_id IS NOT NULL) AND t.id IN (${placeholders})`,
    [userId, userId, ...dependencyIds]
  );
  if (rows.length !== dependencyIds.length) {
    throw apiError(400, "INVALID_DEPENDENCY", "Все связанные задачи должны быть доступны вам.");
  }
  if (taskId) {
    const placeholders = dependencyIds.map(() => "?").join(",");
    const [cycleRows] = await connection.execute(
      `WITH RECURSIVE dependency_tree(task_id) AS (
         SELECT id FROM tasks WHERE id IN (${placeholders})
         UNION DISTINCT
         SELECT d.depends_on_task_id
         FROM task_dependencies d
         JOIN dependency_tree tree ON d.task_id = tree.task_id
       )
       SELECT task_id FROM dependency_tree WHERE task_id = ?`,
      [...dependencyIds, taskId]
    );
    if (cycleRows.length) {
      throw apiError(400, "DEPENDENCY_CYCLE", "Эта зависимость создаст замкнутый цикл.");
    }
  }
}

async function replaceTaskRelations(taskId, data, connection) {
  await connection.execute("DELETE FROM task_dependencies WHERE task_id = ?", [taskId]);
  if (data.dependsOn.length) {
    const values = data.dependsOn.map((dependencyId) => [taskId, dependencyId]);
    await connection.query(
      "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ?",
      [values]
    );
  }
  await connection.execute("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
  if (data.tags.length) {
    await connection.query("INSERT INTO task_tags (task_id, tag) VALUES ?", [
      data.tags.map((tag) => [taskId, tag])
    ]);
  }
}

async function taskDetails(taskId, userId, connection) {
  const [rows] = await connection.execute(
    `SELECT t.id, t.project_id AS projectId, t.title, t.description,
            t.priority, t.status, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS dueDate,
            t.estimate, DATE_FORMAT(t.created_at, '%Y-%m-%d') AS createdAt,
            DATE_FORMAT(t.updated_at, '%Y-%m-%d') AS updatedAt
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE t.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, taskId, userId]
  );
  if (!rows.length) throw apiError(404, "TASK_NOT_FOUND", "Задача не найдена.");
  const task = rows[0];
  const [dependencies] = await connection.execute(
    "SELECT depends_on_task_id AS id FROM task_dependencies WHERE task_id = ?",
    [taskId]
  );
  const [tags] = await connection.execute(
    "SELECT tag FROM task_tags WHERE task_id = ? ORDER BY tag",
    [taskId]
  );
  task.dependsOn = dependencies.map((row) => row.id);
  task.tags = tags.map((row) => row.tag);
  return task;
}

app.get("/api/health", asyncRoute(async (req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ data: { status: "ok", database: "connected" } });
  } catch (error) {
    if (!isDatabaseConnectionError(error)) throw error;
    return res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "База данных временно недоступна. Проверьте настройки подключения."
      }
    });
  }
}));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function imageExtension(buffer) {
  if (buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}

async function removeStoredAvatar(avatarPath) {
  if (!avatarPath || !avatarPath.startsWith("/uploads/avatars/")) return;
  const fileName = path.basename(avatarPath);
  await fs.unlink(path.join(avatarDirectory, fileName)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const errors = {};
  const name = validateString(req.body.name, "name", 2, 100, errors, true);
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    errors.email = "Введите корректный адрес электронной почты.";
  }
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    errors.password = "Пароль должен содержать не менее 8 символов и занимать не более 72 байт в UTF-8.";
  }
  sendValidationErrors(errors);

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute(
    "INSERT INTO users (name, email, password_hash, email_verified_at) VALUES (?, ?, ?, UTC_TIMESTAMP())",
    [name, email, passwordHash]
  );
  const user = {
    id: result.insertId,
    name,
    email,
    avatarUrl: null,
    emailVerified: true
  };
  const session = await createSession(user, req);
  res.status(201).json({ data: { user, ...session } });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  if (!email || typeof password !== "string") {
    throw apiError(400, "VALIDATION_ERROR", "Введите адрес электронной почты и пароль.", {
      email: !email ? "Обязательное поле." : undefined,
      password: typeof password !== "string" ? "Обязательное поле." : undefined
    });
  }
  const [rows] = await pool.execute(
    `SELECT id, name, email, password_hash, email_verified_at AS emailVerifiedAt,
            avatar_path AS avatarPath
     FROM users WHERE email = ?`,
    [email]
  );
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    throw apiError(401, "INVALID_CREDENTIALS", "Неверный адрес электронной почты или пароль.");
  }
  const user = {
    id: rows[0].id,
    name: rows[0].name,
    email: rows[0].email,
    avatarUrl: rows[0].avatarPath,
    emailVerified: Boolean(rows[0].emailVerifiedAt)
  };
  const session = await createSession(user, req);
  res.json({ data: { user, ...session } });
}));

app.patch("/api/auth/profile", authenticate, asyncRoute(async (req, res) => {
  const errors = {};
  const name = validateString(req.body.name, "name", 2, 100, errors, true);
  sendValidationErrors(errors);
  await pool.execute("UPDATE users SET name = ? WHERE id = ?", [name, req.user.id]);
  const [rows] = await pool.execute(
    `SELECT id, name, email, email_verified_at AS emailVerifiedAt,
            avatar_path AS avatarPath
     FROM users WHERE id = ?`,
    [req.user.id]
  );
  res.json({ data: { user: {
    id: rows[0].id,
    name: rows[0].name,
    email: rows[0].email,
    avatarUrl: rows[0].avatarPath,
    emailVerified: Boolean(rows[0].emailVerifiedAt)
  } } });
}));

app.post("/api/auth/avatar", authenticate, (req, res, next) => {
  avatarUpload.single("avatar")(req, res, (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Размер изображения не должен превышать 2 МБ."
        : "Загрузите одно изображение в формате PNG, JPEG или WebP.";
      return next(apiError(400, "INVALID_AVATAR", message));
    }
    return next();
  });
}, asyncRoute(async (req, res) => {
  const extension = req.file && imageExtension(req.file.buffer);
  if (!extension) {
    throw apiError(400, "INVALID_AVATAR", "Загрузите корректное изображение в формате PNG, JPEG или WebP.");
  }

  await fs.mkdir(avatarDirectory, { recursive: true });
  const fileName = `${randomUUID()}${extension}`;
  const avatarPath = `/uploads/avatars/${fileName}`;
  const filePath = path.join(avatarDirectory, fileName);
  await fs.writeFile(filePath, req.file.buffer, { flag: "wx" });
  try {
    const [previous] = await pool.execute("SELECT avatar_path AS avatarPath FROM users WHERE id = ?", [req.user.id]);
    await pool.execute("UPDATE users SET avatar_path = ? WHERE id = ?", [avatarPath, req.user.id]);
    await removeStoredAvatar(previous[0] && previous[0].avatarPath);
  } catch (error) {
    await fs.unlink(filePath).catch(() => {});
    throw error;
  }
  res.json({ data: { avatarUrl: avatarPath } });
}));

app.delete("/api/auth/avatar", authenticate, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute("SELECT avatar_path AS avatarPath FROM users WHERE id = ?", [req.user.id]);
  await pool.execute("UPDATE users SET avatar_path = NULL WHERE id = ?", [req.user.id]);
  await removeStoredAvatar(rows[0] && rows[0].avatarPath);
  res.json({ data: { avatarUrl: null } });
}));

app.post("/api/auth/password", authenticate, asyncRoute(async (req, res) => {
  const currentPassword = req.body.currentPassword;
  const newPassword = req.body.newPassword;
  const errors = {};
  if (typeof currentPassword !== "string" || !currentPassword) {
    errors.currentPassword = "Введите текущий пароль.";
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 ||
      Buffer.byteLength(newPassword, "utf8") > 72) {
    errors.newPassword = "Пароль должен содержать не менее 8 символов и занимать не более 72 байт в UTF-8.";
  }
  sendValidationErrors(errors);

  const [rows] = await pool.execute("SELECT password_hash AS passwordHash FROM users WHERE id = ?", [req.user.id]);
  if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].passwordHash))) {
    throw apiError(400, "CURRENT_PASSWORD_INCORRECT", "Текущий пароль указан неверно.", {
      currentPassword: "Текущий пароль указан неверно."
    });
  }
  if (await bcrypt.compare(newPassword, rows[0].passwordHash)) {
    throw apiError(400, "PASSWORD_UNCHANGED", "Новый пароль должен отличаться от текущего.", {
      newPassword: "Новый пароль должен отличаться от текущего."
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, req.user.id]);
  await pool.execute(
    `UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
    [req.user.id, req.user.sessionId]
  );
  res.json({ data: { message: "Пароль изменён. Остальные активные сеансы завершены." } });
}));

app.post("/api/auth/logout", authenticate, asyncRoute(async (req, res) => {
  await pool.execute(
    "UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [req.user.sessionId, req.user.id]
  );
  res.json({ data: { message: "Сеанс завершён." } });
}));

app.get("/api/auth/me", authenticate, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, name, email, email_verified_at AS emailVerifiedAt,
            avatar_path AS avatarPath, created_at AS createdAt
     FROM users WHERE id = ?`,
    [req.user.id]
  );
  if (!rows.length) throw apiError(401, "INVALID_TOKEN", "Аккаунт больше не существует.");
  res.json({ data: { user: {
    id: rows[0].id,
    name: rows[0].name,
    email: rows[0].email,
    emailVerified: Boolean(rows[0].emailVerifiedAt),
    avatarUrl: rows[0].avatarPath,
    createdAt: rows[0].createdAt
  } } });
}));

app.get("/api/auth/sessions", authenticate, asyncRoute(async (req, res) => {
  const [sessions] = await pool.execute(
    `SELECT id, user_agent AS userAgent, ip_address AS ipAddress,
            created_at AS createdAt, expires_at AS expiresAt
     FROM user_sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ data: { sessions: sessions.map((session) => ({
    ...session,
    current: session.id === req.user.sessionId
  })) } });
}));

app.delete("/api/auth/sessions/:id", authenticate, asyncRoute(async (req, res) => {
  const sessionId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    throw apiError(400, "INVALID_ID", "Идентификатор сеанса должен иметь формат UUID.");
  }
  const [result] = await pool.execute(
    `UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP()
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [sessionId, req.user.id]
  );
  if (!result.affectedRows) throw apiError(404, "SESSION_NOT_FOUND", "Активный сеанс не найден.");
  res.status(204).end();
}));

app.use("/api", authenticate);

app.get("/api/projects", asyncRoute(async (req, res) => {
  const [projects] = await pool.execute(
    `SELECT p.id, p.name, p.color, p.created_at AS createdAt,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS taskCount,
            CASE WHEN p.user_id = ? THEN 'owner' ELSE pm.member_role END AS memberRole
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.user_id = ? OR pm.user_id IS NOT NULL
     ORDER BY p.created_at, p.id`,
    [req.user.id, req.user.id, req.user.id]
  );
  res.json({ data: { projects } });
}));

app.post("/api/projects", asyncRoute(async (req, res) => {
  const data = validateProject(req.body, false);
  const [result] = await pool.execute(
    "INSERT INTO projects (user_id, name, color) VALUES (?, ?, ?)",
    [req.user.id, data.name, data.color]
  );
  res.status(201).json({ data: { project: { id: result.insertId, ...data, memberRole: "owner" } } });
}));

app.patch("/api/projects/:id", asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, "Project id");
  const data = validateProject(req.body, true);
  if (!Object.keys(data).length) throw apiError(400, "VALIDATION_ERROR", "Укажите хотя бы одно поле для изменения.");
  await ownedProject(req.user.id, id, pool, true);
  const [result] = await pool.execute(
    "UPDATE projects SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND user_id = ?",
    [data.name || null, data.color || null, id, req.user.id]
  );
  const [rows] = await pool.execute(
    "SELECT id, name, color FROM projects WHERE id = ? AND user_id = ?",
    [id, req.user.id]
  );
  res.json({ data: { project: rows[0] } });
}));

app.delete("/api/projects/:id", asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, "Project id");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [projects] = await connection.execute(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE",
      [id, req.user.id]
    );
    if (!projects.length) throw apiError(404, "PROJECT_NOT_FOUND", "Проект не найден.");
    const [tasks] = await connection.execute("SELECT id FROM tasks WHERE project_id = ? LIMIT 1", [id]);
    if (tasks.length) {
      throw apiError(409, "PROJECT_HAS_TASKS", "Перед удалением проекта удалите или перенесите его задачи.");
    }
    await connection.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", [id, req.user.id]);
    await connection.commit();
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post("/api/projects/:id/invitations", asyncRoute(async (req, res) => {
  const projectId = requireId(req.params.id, "Project id");
  await ownedProject(req.user.id, projectId, pool, true);
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const role = req.body.role;
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = "Введите корректный адрес электронной почты.";
  }
  if (role !== "editor" && role !== "viewer") {
    errors.role = "Выберите права «Редактирование» или «Только просмотр».";
  }
  sendValidationErrors(errors);
  if (email === String(req.user.email).toLowerCase()) {
    throw apiError(409, "ALREADY_PROJECT_OWNER", "Владелец уже является участником проекта.");
  }

  const [users] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
  if (!users.length) {
    throw apiError(404, "ACCOUNT_NOT_FOUND", "Аккаунт с таким адресом электронной почты не найден.");
  }
  const inviteeId = Number(users[0].id);
  const [members] = await pool.execute(
    "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, inviteeId]
  );
  if (members.length) throw apiError(409, "ALREADY_PROJECT_MEMBER", "Этот пользователь уже участвует в проекте.");

  const [result] = await pool.execute(
    `INSERT INTO project_invitations
       (project_id, inviter_id, invitee_email, invitee_id, member_role, status, responded_at)
     VALUES (?, ?, ?, ?, ?, 'pending', NULL)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), inviter_id = VALUES(inviter_id),
       invitee_id = VALUES(invitee_id), member_role = VALUES(member_role), status = 'pending',
       created_at = CURRENT_TIMESTAMP, responded_at = NULL`,
    [projectId, req.user.id, email, inviteeId, role]
  );
  res.status(201).json({ data: { invitation: { id: result.insertId, projectId, email, role, status: "pending" } } });
}));

app.get("/api/projects/:id/members", asyncRoute(async (req, res) => {
  const projectId = requireId(req.params.id, "Project id");
  const permission = await ownedProject(req.user.id, projectId, pool);
  const [members] = await pool.execute(
    `SELECT u.id, u.name, u.email, pm.member_role AS \`role\`, pm.created_at AS joinedAt
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     UNION ALL
     SELECT u.id, u.name, u.email, 'owner' AS \`role\`, p.created_at AS joinedAt
     FROM projects p JOIN users u ON u.id = p.user_id
     WHERE p.id = ?`,
    [projectId, projectId]
  );
  res.json({ data: { members, currentRole: permission.role } });
}));

app.patch("/api/projects/:id/members/:userId", asyncRoute(async (req, res) => {
  const projectId = requireId(req.params.id, "Project id");
  const userId = requireId(req.params.userId, "User id");
  await ownedProject(req.user.id, projectId, pool, true);
  if (req.body.role !== "editor" && req.body.role !== "viewer") {
    throw apiError(400, "VALIDATION_ERROR", "Выберите права «Редактирование» или «Только просмотр».", {
      role: "Выберите допустимую роль участника."
    });
  }
  const [result] = await pool.execute(
    "UPDATE project_members SET member_role = ? WHERE project_id = ? AND user_id = ?",
    [req.body.role, projectId, userId]
  );
  if (!result.affectedRows) throw apiError(404, "PROJECT_MEMBER_NOT_FOUND", "Участник проекта не найден.");
  res.json({ data: { member: { userId, role: req.body.role } } });
}));

app.delete("/api/projects/:id/members/:userId", asyncRoute(async (req, res) => {
  const projectId = requireId(req.params.id, "Project id");
  const userId = requireId(req.params.userId, "User id");
  if (userId === req.user.id) {
    await ownedProject(req.user.id, projectId, pool);
  } else {
    await ownedProject(req.user.id, projectId, pool, true);
  }
  const [result] = await pool.execute(
    "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (!result.affectedRows) throw apiError(404, "PROJECT_MEMBER_NOT_FOUND", "Участник проекта не найден.");
  res.status(204).end();
}));

app.get("/api/notifications/invitations", asyncRoute(async (req, res) => {
  const [invitations] = await pool.execute(
    `SELECT i.id, i.project_id AS projectId, i.member_role AS \`role\`, i.created_at AS createdAt,
            p.name AS projectName, p.color AS projectColor, u.name AS inviterName
     FROM project_invitations i
     JOIN projects p ON p.id = i.project_id
     JOIN users u ON u.id = i.inviter_id
     WHERE i.invitee_id = ? AND i.status = 'pending'
     ORDER BY i.created_at DESC`,
    [req.user.id]
  );
  res.json({ data: { invitations } });
}));

app.post("/api/notifications/invitations/:id/respond", asyncRoute(async (req, res) => {
  const invitationId = requireId(req.params.id, "Invitation id");
  const action = req.body.action;
  if (action !== "accept" && action !== "decline") {
    throw apiError(400, "VALIDATION_ERROR", "Выберите: принять или отклонить.", {
      action: "Недопустимый ответ на приглашение."
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, project_id AS projectId, member_role AS memberRole FROM project_invitations
       WHERE id = ? AND invitee_id = ? AND status = 'pending' FOR UPDATE`,
      [invitationId, req.user.id]
    );
    if (!rows.length) throw apiError(404, "INVITATION_NOT_FOUND", "Приглашение не найдено или на него уже ответили.");
    const invitation = rows[0];
    if (action === "accept") {
      await connection.execute(
        `INSERT INTO project_members (project_id, user_id, member_role, invited_by)
         SELECT project_id, ?, member_role, inviter_id FROM project_invitations WHERE id = ?
         ON DUPLICATE KEY UPDATE member_role = VALUES(member_role)`,
        [req.user.id, invitationId]
      );
    }
    await connection.execute(
      "UPDATE project_invitations SET status = ?, invitee_id = ?, responded_at = UTC_TIMESTAMP() WHERE id = ?",
      [action === "accept" ? "accepted" : "declined", req.user.id, invitationId]
    );
    await connection.commit();
    res.json({ data: { invitation: { id: invitationId, projectId: invitation.projectId, status: action === "accept" ? "accepted" : "declined" } } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get("/api/tasks", asyncRoute(async (req, res) => {
  const conditions = ["(p.user_id = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))"];
  const params = [req.user.id, req.user.id];
  if (req.query.projectId !== undefined) {
    conditions.push("t.project_id = ?");
    params.push(requireId(req.query.projectId, "Project id"));
  }
  if (req.query.status !== undefined) {
    if (!statuses.has(req.query.status)) throw apiError(400, "VALIDATION_ERROR", "Выберите допустимый статус.");
    conditions.push("t.status = ?");
    params.push(req.query.status);
  }
  if (req.query.priority !== undefined) {
    if (!priorities.has(req.query.priority)) throw apiError(400, "VALIDATION_ERROR", "Выберите допустимый приоритет.");
    conditions.push("t.priority = ?");
    params.push(req.query.priority);
  }
  const [rows] = await pool.execute(
    `SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE ${conditions.join(" AND ")} ORDER BY t.created_at DESC`,
    params
  );
  const tasks = [];
  for (const row of rows) tasks.push(await taskDetails(row.id, req.user.id, pool));
  res.json({ data: { tasks } });
}));

app.post("/api/tasks", asyncRoute(async (req, res) => {
  const data = validateTask(req.body, false);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ownedProject(req.user.id, data.projectId, connection, false, true);
    await ensureOwnedDependencies(req.user.id, null, data.dependsOn, connection);
    const [result] = await connection.execute(
      `INSERT INTO tasks
       (project_id, title, description, priority, status, due_date, estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.projectId, data.title, data.description, data.priority, data.status, data.dueDate, data.estimate]
    );
    await replaceTaskRelations(result.insertId, data, connection);
    if (startedStatuses.has(data.status)) {
      const blockers = await getUnmetDependencies(result.insertId, connection);
      if (blockers.length) throw apiError(409, "TASK_BLOCKED", "Нельзя начать задачу, пока не завершены её зависимости.", { blockers });
    }
    await connection.commit();
    res.status(201).json({ data: { task: await taskDetails(result.insertId, req.user.id, pool) } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get("/api/tasks/:id", asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, "Task id");
  res.json({ data: { task: await taskDetails(id, req.user.id, pool) } });
}));

app.put("/api/tasks/:id", asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, "Task id");
  const data = validateTask(req.body, false);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ownedTask(req.user.id, id, connection, true);
    await ownedProject(req.user.id, data.projectId, connection, false, true);
    await ensureOwnedDependencies(req.user.id, id, data.dependsOn, connection);
    await connection.execute(
      `UPDATE tasks SET project_id = ?, title = ?, description = ?, priority = ?,
       status = ?, due_date = ?, estimate = ? WHERE id = ?`,
      [data.projectId, data.title, data.description, data.priority, data.status, data.dueDate, data.estimate, id]
    );
    await replaceTaskRelations(id, data, connection);
    if (startedStatuses.has(data.status)) {
      const blockers = await getUnmetDependencies(id, connection);
      if (blockers.length) throw apiError(409, "TASK_BLOCKED", "Нельзя начать задачу, пока не завершены её зависимости.", { blockers });
    }
    await connection.commit();
    res.json({ data: { task: await taskDetails(id, req.user.id, pool) } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch("/api/tasks/:id/status", asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, "Task id");
  const status = req.body.status;
  if (!statuses.has(status)) {
    throw apiError(400, "VALIDATION_ERROR", "Выберите допустимый статус.", {
      status: "Выберите допустимый статус задачи."
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ownedTask(req.user.id, id, connection, true);
    if (startedStatuses.has(status)) {
      const blockers = await getUnmetDependencies(id, connection);
      if (blockers.length) throw apiError(409, "TASK_BLOCKED", "Нельзя начать задачу, пока не завершены её зависимости.", { blockers });
    }
    await connection.execute("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
    await connection.commit();
    res.json({ data: { task: await taskDetails(id, req.user.id, pool) } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.delete("/api/tasks/:id", asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, "Task id");
  const [result] = await pool.execute(
    `DELETE t FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE t.id = ? AND (p.user_id = ? OR (pm.user_id IS NOT NULL AND pm.member_role = 'editor'))`,
    [req.user.id, id, req.user.id]
  );
  if (!result.affectedRows) throw apiError(404, "TASK_NOT_FOUND", "Задача не найдена.");
  res.status(204).end();
}));

async function getUnmetDependencies(taskId, connection) {
  const [rows] = await connection.execute(
    `SELECT t.id, t.title, t.status
     FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id
     WHERE d.task_id = ? AND t.status <> 'done'`,
    [taskId]
  );
  return rows;
}

app.get("/api/stats", asyncRoute(async (req, res) => {
  const projectId = req.query.projectId === undefined ? null : requireId(req.query.projectId, "Project id");
  if (projectId !== null) await ownedProject(req.user.id, projectId, pool);
  const params = projectId === null
    ? [req.user.id, req.user.id]
    : [req.user.id, req.user.id, projectId];
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(t.status = 'done') AS done,
            SUM(t.status <> 'done') AS active,
            SUM(t.status <> 'done' AND t.due_date < UTC_DATE()) AS overdue,
            SUM(t.status <> 'done' AND t.due_date >= UTC_DATE()
                AND t.due_date <= DATE_ADD(UTC_DATE(), INTERVAL 2 DAY)) AS dueSoon,
            SUM(t.priority IN ('high', 'critical') AND t.status <> 'done') AS highPriority,
            SUM(t.status <> 'done' AND EXISTS (
              SELECT 1 FROM task_dependencies d
              JOIN tasks blocker ON blocker.id = d.depends_on_task_id
              WHERE d.task_id = t.id AND blocker.status <> 'done'
            )) AS blocked,
            COALESCE(SUM(t.estimate), 0) AS hoursTotal,
            COALESCE(SUM(IF(t.status = 'done', t.estimate, 0)), 0) AS hoursDone
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE (p.user_id = ? OR EXISTS (
       SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
     ))${projectId === null ? "" : " AND t.project_id = ?"}`,
    params
  );
  const row = rows[0];
  const total = Number(row.total);
  res.json({ data: { stats: {
    total,
    done: Number(row.done),
    active: Number(row.active),
    overdue: Number(row.overdue),
    dueSoon: Number(row.dueSoon),
    highPriority: Number(row.highPriority),
    blocked: Number(row.blocked),
    hoursTotal: Number(row.hoursTotal),
    hoursDone: Number(row.hoursDone),
    progress: total ? Math.round((Number(row.done) / total) * 100) : 0
  } } });
}));

app.use((req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    return next(apiError(404, "ROUTE_NOT_FOUND", "Маршрут API не найден."));
  }
  return sendErrorPage(res, 404, "Страница не найдена", "Похоже, такой страницы здесь нет.");
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const isApiRequest = req.path === "/api" || req.path.startsWith("/api/");
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: { code: "INVALID_JSON", message: "Тело запроса содержит некорректный JSON." } });
  }
  if (error.code === "ER_DUP_ENTRY") {
    const duplicate = apiError(409, "DUPLICATE_RESOURCE", "Запись с таким значением уже существует.");
    return res.status(409).json({ error: { code: duplicate.code, message: duplicate.message } });
  }
  if (isDatabaseConnectionError(error)) {
    console.error("MySQL connection failed:", error.code || error.message);
    if (!isApiRequest) {
      return sendErrorPage(res, 503, "Сервис временно недоступен", "Не удалось подключиться к базе данных. Попробуйте зайти позже.");
    }
    return res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "База данных временно недоступна. Проверьте настройки подключения."
      }
    });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  if (!isApiRequest && (status === 404 || status >= 500)) {
    const notFound = status === 404;
    return sendErrorPage(
      res,
      status,
      notFound ? "Страница не найдена" : "Что-то пошло не так",
      notFound
        ? "Похоже, такой страницы здесь нет."
        : "На сервере произошла ошибка. Попробуйте обновить страницу чуть позже."
    );
  }
  const hasApiErrorCode = typeof error.code === "string" && /^[A-Z_]+$/.test(error.code);
  const response = { error: { code: error.code || "INTERNAL_ERROR",
    message: status >= 500
      ? "На сервере произошла непредвиденная ошибка."
      : hasApiErrorCode ? error.message : "Не удалось обработать запрос. Проверьте данные и повторите попытку." } };
  if (error.details) response.error.details = error.details;
  return res.status(status).json(response);
});

function sendErrorPage(res, status, title, message) {
  return res.status(status).type("html").send(
    errorPageTemplate
      .replaceAll("{{STATUS}}", String(status))
      .replaceAll("{{TITLE}}", escapeHtml(title))
      .replaceAll("{{MESSAGE}}", escapeHtml(message))
  );
}

function isDatabaseConnectionError(error) {
  if (!error) return false;
  const connectionCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "PROTOCOL_CONNECTION_LOST",
    "ER_ACCESS_DENIED_ERROR",
    "ER_BAD_DB_ERROR"
  ]);
  return connectionCodes.has(error.code) ||
    (Array.isArray(error.errors) && error.errors.some(isDatabaseConnectionError));
}

async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("Подключение к MySQL установлено.");
  } catch (error) {
    if (!isDatabaseConnectionError(error)) throw error;
    console.warn("База данных недоступна. Сайт запустится, но запросы к API будут возвращать ошибку 503.");
    console.warn("Запустите MySQL и проверьте настройки базы данных в .env.");
  }
  app.listen(port, () => console.log(`MindSpace запущен: http://localhost:${port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Не удалось запустить API-сервер:", error);
    process.exitCode = 1;
  });
}

module.exports = { app, pool, validateTask, validateProject };
