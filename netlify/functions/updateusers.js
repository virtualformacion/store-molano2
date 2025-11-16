// netlify/functions/update-users.js
// Node 18+ runtime (Netlify). Usa fetch nativo.

// ========== ADMIN FIJO (NO EDITAR) ==========
const FIXED_ADMIN = {
  username: "admin",
  password: "123456",
  expiresAt: "2025-12-16"
};
// ============================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || "virtualformacion";
const REPO_NAME = process.env.REPO_NAME || "store-molano2";
const FILE_PATH = process.env.FILE_PATH || "script.js";
const BRANCH = process.env.BRANCH || "main";

if (!GITHUB_TOKEN) console.error("Falta GITHUB_TOKEN en env vars");

const headers = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${GITHUB_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json"
};

async function getFileFromGitHub() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf8");
  return { content, sha: json.sha };
}

function extractUsersBlock(content) {
  const startMatch = content.match(/const\s+USERS\s*=\s*\[/);
  if (!startMatch) return null;
  const startIndex = content.indexOf(startMatch[0]);

  let pos = startIndex + startMatch[0].length - 1;
  let bracketDepth = 1;

  while (pos < content.length) {
    pos++;
    const ch = content[pos];
    if (ch === "[") bracketDepth++;
    if (ch === "]") {
      bracketDepth--;
      if (bracketDepth === 0) {
        const endPos = content.indexOf(";", pos);
        const endIndex = endPos !== -1 ? endPos + 1 : pos + 1;
        return {
          startIndex,
          endIndex,
          usersText: content.slice(startIndex, endIndex)
        };
      }
    }
  }
  return null;
}

function evalUsersArray(usersText) {
  const afterEquals = usersText.split("=")[1];
  if (!afterEquals) throw new Error("No se pudo parsear usersText");

  const arrExpr = afterEquals.trim().replace(/;$/, "");

  const fn = new Function(`return (${arrExpr});`);
  return fn();
}

function buildUsersBlockString(usersArray) {
  const items = usersArray.map(u => {
    const uname = JSON.stringify(u.username);
    const pwd = JSON.stringify(u.password);
    const d = new Date(u.expiresAt);
    const iso = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    return `    { username: ${uname}, password: ${pwd}, expiresAt: new Date("${iso}") }`;
  });

  return `const USERS = [\n${items.join(",\n")}\n];`;
}

async function putFileToGitHub(newContent, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(newContent, "utf8").toString("base64"),
    branch: BRANCH,
    sha
  };
  const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
    }

    const payload = JSON.parse(event.body || "{}");
    const { action, adminUser, adminPass, payload: data } = payload;

    if (!action || !adminUser || !adminPass) {
      return { statusCode: 400, body: JSON.stringify({ error: "Faltan parámetros" }) };
    }

    // ========== VALIDACIÓN DE ADMIN FIJO ==========
    if (adminUser !== FIXED_ADMIN.username || adminPass !== FIXED_ADMIN.password) {
      return { statusCode: 401, body: JSON.stringify({ error: "Credenciales admin inválidas" }) };
    }

    const now = new Date();
    if (now > new Date(FIXED_ADMIN.expiresAt)) {
      return { statusCode: 403, body: JSON.stringify({ error: "Acceso admin vencido, renueva tu plan ahora para seguir administrando tu web" }) };
    }
    // ===================================================

    // Leer el archivo script.js
    const { content, sha } = await getFileFromGitHub();

    const block = extractUsersBlock(content);
    if (!block) return { statusCode: 500, body: JSON.stringify({ error: "No se encontró USERS en script.js" }) };

    let usersArray = evalUsersArray(block.usersText);

    // Asegurar que admin NO se toque nunca
    usersArray = usersArray.filter(u => u.username !== "admin");

    // ================= ACCIONES ==================

    if (action === "list") {
      return { statusCode: 200, body: JSON.stringify({ users: usersArray }) };
    }

    if (action === "create") {
      const { username, password, expiresAt } = data || {};
      if (!username || !password || !expiresAt)
        return { statusCode: 400, body: JSON.stringify({ error: "Campos incompletos" }) };

      if (username === "admin")
        return { statusCode: 403, body: JSON.stringify({ error: "Prohibido modificar admin" }) };

      if (usersArray.some(u => u.username === username))
        return { statusCode: 409, body: JSON.stringify({ error: "Usuario ya existe" }) };

      usersArray.push({ username, password, expiresAt });
    }

    if (action === "edit") {
      const { username, newUsername, password, expiresAt } = data || {};

      if (!username)
        return { statusCode: 400, body: JSON.stringify({ error: "Falta username" }) };

      if (username === "admin")
        return { statusCode: 403, body: JSON.stringify({ error: "No permitido editar admin" }) };

      const idx = usersArray.findIndex(u => u.username === username);
      if (idx === -1) return { statusCode: 404, body: JSON.stringify({ error: "Usuario no encontrado" }) };

      if (newUsername) usersArray[idx].username = newUsername;
      if (password) usersArray[idx].password = password;
      if (expiresAt) usersArray[idx].expiresAt = expiresAt;
    }

    if (action === "delete") {
      const { username } = data || {};

      if (username === "admin")
        return { statusCode: 403, body: JSON.stringify({ error: "No permitido eliminar admin" }) };

      const before = usersArray.length;
      usersArray = usersArray.filter(u => u.username !== username);
      if (before === usersArray.length)
        return { statusCode: 404, body: JSON.stringify({ error: "Usuario no encontrado" }) };
    }

    // ========= Reemplazar bloque USERS y hacer commit ==========
    const usersBlock = buildUsersBlockString(usersArray);
    const newContent = content.slice(0, block.startIndex) + usersBlock + content.slice(block.endIndex);

    const commit = await putFileToGitHub(
      newContent,
      sha,
      `Actualizar usuarios (${action}) desde admin`
    );

    return { statusCode: 200, body: JSON.stringify({ success: true, commit }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};

