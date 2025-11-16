// netlify/functions/update-users.js
// Node 18+ runtime (Netlify). Usa fetch nativo.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || "virtualformacion";
const REPO_NAME = process.env.REPO_NAME || "store-molano";
const FILE_PATH = process.env.FILE_PATH || "script.js";
const BRANCH = process.env.BRANCH || "main";

if (!GITHUB_TOKEN) {
  console.error("Falta GITHUB_TOKEN en env vars");
}

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
  // buscamos el bloque que empieza con const USERS = [
  const startMatch = content.match(/const\s+USERS\s*=\s*\[/);
  if (!startMatch) return null;
  const startIndex = content.indexOf(startMatch[0]);
  // búsqueda del cierre de array (];) que corresponde
  let pos = startIndex + startMatch[0].length - 1;
  let bracketDepth = 1;
  while (pos < content.length) {
    pos++;
    const ch = content[pos];
    if (ch === "[") bracketDepth++;
    if (ch === "]") {
      bracketDepth--;
      if (bracketDepth === 0) {
        // buscamos el siguiente punto y coma ;
        const endPos = content.indexOf(";", pos);
        const endIndex = endPos !== -1 ? endPos + 1 : pos + 1;
        const usersText = content.slice(startIndex, endIndex);
        return {
          startIndex,
          endIndex,
          usersText
        };
      }
    }
  }
  return null;
}

function evalUsersArray(usersText) {
  // usersText es algo como "const USERS = [ { username: ... }, ... ];"
  // convertimos a solo array expresion y evaluamos en un contexto seguro.
  // Extraemos la porción que está entre el = y el cierre ];
  const afterEquals = usersText.split("=")[1];
  if (!afterEquals) throw new Error("No se pudo parsear usersText");
  // Queremos evaluar el array. Lo hacemos con Function para evitar usar eval global.
  const arrExpr = afterEquals.trim().replace(/;$/, "");
  // Para que new Date(...) se ejecute, lo permitimos.
  const fn = new Function(`return (${arrExpr});`);
  return fn();
}

function buildUsersBlockString(usersArray) {
  // Construimos un código JS con new Date("YYYY-MM-DD")
  const items = usersArray.map(u => {
    const uname = JSON.stringify(u.username);
    const pwd = JSON.stringify(u.password);
    // Normalizar fecha a YYYY-MM-DD
    const d = new Date(u.expiresAt);
    const iso = !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
    return `    { username: ${uname}, password: ${pwd}, expiresAt: new Date("${iso}") }`;
  });
  const inner = items.join(",\n");
  return `const USERS = [\n${inner}\n];`;
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
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub PUT failed: ${res.status} ${txt}`);
  }
  return await res.json();
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
    }
    const payload = JSON.parse(event.body || "{}");
    const { action, adminUser, adminPass, payload: data } = payload;
    if (!action || !adminUser || !adminPass) {
      return { statusCode: 400, body: JSON.stringify({ error: "Faltan parámetros" }) };
    }

    // 1) Leemos script.js
    const { content, sha } = await getFileFromGitHub();

    // 2) Extraemos bloque USERS
    const block = extractUsersBlock(content);
    if (!block) return { statusCode: 500, body: JSON.stringify({ error: "No se encontró block USERS en el archivo." }) };

    // 3) Evaluamos usuarios actuales
    const usersArray = evalUsersArray(block.usersText);

    // 4) Validamos admin (buscamos user 'admin' en usersArray)
    const admin = usersArray.find(u => String(u.username) === String(adminUser));
    if (!admin || String(admin.password) !== String(adminPass)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Credenciales admin inválidas" }) };
    }
    // Comprobar expiración admin
    const now = new Date();
    const adminExpires = new Date(admin.expiresAt);
    if (!isNaN(adminExpires.getTime()) && adminExpires < now) {
      return { statusCode: 403, body: JSON.stringify({ error: "Cuenta admin expirada" }) };
    }

    // 5) Operaciones permitidas sobre users (excluyendo admin)
    let modified = false;
    let newUsers = usersArray.slice(); // clon

    if (action === "list") {
      // devolver lista sin admin
      const out = newUsers.filter(u => u.username !== "admin");
      return { statusCode: 200, body: JSON.stringify({ users: out }) };
    }

    if (action === "create") {
      const { username, password, expiresAt } = data || {};
      if (!username || !password || !expiresAt) return { statusCode: 400, body: JSON.stringify({ error: "Faltan datos para crear usuario" }) };
      // evitar crear admin por web
      if (username === "admin") return { statusCode: 403, body: JSON.stringify({ error: "No está permitido crear/editar admin" }) };
      // evitar duplicados por username
      if (newUsers.some(u => u.username === username)) return { statusCode: 409, body: JSON.stringify({ error: "Usuario ya existe" }) };
      newUsers.push({ username, password, expiresAt: new Date(expiresAt).toISOString().slice(0,10) });
      modified = true;
    } else if (action === "delete") {
      const { username } = data || {};
      if (!username) return { statusCode: 400, body: JSON.stringify({ error: "Falta username para eliminar" }) };
      if (username === "admin") return { statusCode: 403, body: JSON.stringify({ error: "No permitido eliminar admin" }) };
      const before = newUsers.length;
      newUsers = newUsers.filter(u => u.username !== username);
      if (newUsers.length === before) return { statusCode: 404, body: JSON.stringify({ error: "Usuario no encontrado" }) };
      modified = true;
    } else if (action === "edit") {
      const { username, newUsername, password, expiresAt } = data || {};
      if (!username) return { statusCode: 400, body: JSON.stringify({ error: "Falta username para editar" }) };
      if (username === "admin") return { statusCode: 403, body: JSON.stringify({ error: "No permitido editar admin" }) };
      const idx = newUsers.findIndex(u => u.username === username);
      if (idx === -1) return { statusCode: 404, body: JSON.stringify({ error: "Usuario no encontrado" }) };
      if (newUsername) {
        // check duplicate
        if (newUsername !== username && newUsers.some(u => u.username === newUsername)) return { statusCode: 409, body: JSON.stringify({ error: "Nuevo username ya existe" }) };
        newUsers[idx].username = newUsername;
      }
      if (password) newUsers[idx].password = password;
      if (expiresAt) newUsers[idx].expiresAt = new Date(expiresAt).toISOString().slice(0,10);
      modified = true;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Acción no reconocida" }) };
    }

    // 6) Si hubo cambio, reemplazar bloque USERS y hacer commit
    if (modified) {
      // Re-armar bloque completo (incluimos admin y otros, por eso usamos newUsers que contiene todos)
      // NOTA: newUsers actualmente es array de objetos. Queremos asegurarnos de mantener admin en el array original.
      // Aseguramos admin persiste: si admin no estaba en newUsers lo recuperamos.
      const originalAdmin = usersArray.find(u => u.username === "admin");
      let combined = newUsers.filter(u => u.username !== "admin");
      if (originalAdmin && !combined.some(u=>u.username==="admin")) {
        combined.push(originalAdmin);
      } else if (!originalAdmin) {
        // No existía admin (raro). No lo agregamos.
      }
      // construimos string
      const usersBlock = buildUsersBlockString(combined);
      // sustituir block.usersText en content
      const newContent = content.slice(0, block.startIndex) + usersBlock + content.slice(block.endIndex);
      const commitMessage = `Actualizar USERS via admin web - acción: ${action}`;
      const res = await putFileToGitHub(newContent, sha, commitMessage);
      return { statusCode: 200, body: JSON.stringify({ success: true, result: res }) };
    }

    // Si no se modificó y la acción fue list, ya devolvimos. Aquí por seguridad.
    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
