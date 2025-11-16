// ========== USUARIOS AUTORIZADOS (NO EDITAR MANUALMENTE EN ESTE BLOQUE) ==========
// <USERS_DATA>
const USERS = [
    { username: "lord", password: "1111", expiresAt: new Date("2025-11-28") },
    { username: "codigos", password: "3602", expiresAt: new Date("2025-12-02") },
    { username: "usuario448", password: "4448", expiresAt: new Date("2025-12-10") },
    { username: "usuario950", password: "6244", expiresAt: new Date("2025-12-12") },
    { username: "usuario507", password: "3012", expiresAt: new Date("2025-12-12") },
    { username: "usuario412", password: "1716", expiresAt: new Date("2025-12-12") },
    { username: "code309", password: "9425", expiresAt: new Date("2025-12-16") },
    { username: "code933", password: "4232", expiresAt: new Date("2025-12-16") },
    { username: "code283", password: "1667", expiresAt: new Date("2025-12-16") },
    { username: "andres", password: "1111", expiresAt: new Date("2025-11-30") }
];
// </USERS_DATA>



const MAX_ATTEMPTS = 300000;
const BLOCK_HOURS = 24;

// ========== LOGIN ==========
document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();

    const username = document.getElementById("loginUser").value.trim();
    const password = document.getElementById("loginPass").value.trim();
    const message = document.getElementById("loginMessage");
    const user = USERS.find(u => u.username === username);
    const storageKey = `login_${username}`;
    const loginData = JSON.parse(localStorage.getItem(storageKey)) || {
        attempts: 0,
        blockedUntil: null
    };

    const now = new Date();

    // Si está bloqueado
    if (loginData.blockedUntil && now < new Date(loginData.blockedUntil)) {
        message.textContent = "Has escrito datos incorrectos muchas veces. Vuelve a intentarlo en 24 horas.";
        return;
    }

    // Validar usuario
    if (!user || user.password !== password) {
        loginData.attempts += 1;
        if (loginData.attempts >= MAX_ATTEMPTS) {
            loginData.blockedUntil = new Date(now.getTime() + BLOCK_HOURS * 60 * 60 * 1000).toISOString();
            message.textContent = "Has escrito datos incorrectos muchas veces. Vuelve a intentarlo en 24 horas.";
        } else {
            message.textContent = "Datos incorrectos. Por favor vuelve a intentarlo.";
        }
        localStorage.setItem(storageKey, JSON.stringify(loginData));
        return;
    }

    // Validar expiración
    if (now > new Date(user.expiresAt)) {
        message.textContent = "Tu usuario ha vencido, contacta al desarrollador web para renovar tu servicio.";
        return;
    }

    // Acceso autorizado
    localStorage.removeItem(storageKey);
    document.getElementById("loginContainer").style.display = "none";
    document.querySelector(".container").style.display = "block";
});

// ========== TU LÓGICA ORIGINAL (MODIFICADA) ==========
document.getElementById("emailForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    
    const email = document.getElementById("email").value;

    const loadingMessage = document.createElement("div");
    loadingMessage.textContent = "Espere unos segundos por favor. Consulta en proceso.";
    loadingMessage.style.position = "fixed";
    loadingMessage.style.top = "50%";
    loadingMessage.style.left = "50%";
    loadingMessage.style.transform = "translate(-50%, -50%)";
    loadingMessage.style.padding = "10px 20px";
    loadingMessage.style.backgroundColor = "#000000";
    loadingMessage.style.border = "1px solid #ccc";
    loadingMessage.style.borderRadius = "5px";
    loadingMessage.style.fontSize = "16px";
    loadingMessage.style.zIndex = "1000";
    loadingMessage.style.display = "block";

    document.body.appendChild(loadingMessage);

    try {
        const response = await fetch("/.netlify/functions/getLastEmail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });

        const data = await response.json();
        loadingMessage.style.display = "none";

        if (data.alert) {
            document.getElementById("messageBody").innerHTML = data.body;
            document.getElementById("messageModal").style.display = 'block';
        } else if (data.link) {
            window.location.href = data.link;
        } else {
            alert("No se encontró resultado para tu cuenta, vuelve a intentarlo nuevamente.");
        }
    } catch (error) {
        loadingMessage.style.display = "none";
        alert("Ocurrió un error al procesar la solicitud. Por favor, inténtalo de nuevo.");
    }
});

document.getElementById("closeModal").addEventListener("click", function () {
    document.getElementById("messageModal").style.display = 'none';
});
