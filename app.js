const FORBIDDEN_PREFIXES = [
    "Discussion:",
    "Discussion utilisateur:",
    "Utilisateur:",
    "Wikipédia:",
    "Projet:",
    "Aide:",
    "Portail:",
    "Catégorie:",
    "Fichier:",
    "MediaWiki:",
    "Modèle:",
    "Spécial:",
    "Module:"
];

let startPage = "";
let targetPage = "";
let currentPage = "";

let clicks = 0;
let seconds = 0;
let timer;

let peer = null;
let hostConnection = null;
let connections = [];

let isHost = false;
let gameStarted = false;

let localPlayerId = "";
let localNickname = "";

let players = [];

// ---------------------
// Éléments HTML
// ---------------------

const nicknameInput = document.getElementById("nicknameInput");
const roomIdInput = document.getElementById("roomIdInput");
const createRoomButton = document.getElementById("createRoom");
const joinRoomButton = document.getElementById("joinRoom");
const copyInviteButton = document.getElementById("copyInvite");
const newGameButton = document.getElementById("newGame");
const peerStatus = document.getElementById("peerStatus");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const inviteStatus = document.getElementById("inviteStatus");
const playersContainer = document.getElementById("players");

// ---------------------
// Utils
// ---------------------

function getNickname() {
    const nickname = nicknameInput.value.trim();

    if (nickname) {
        return nickname;
    }

    return "Joueur";
}

function getInviteLink() {
    const url = new URL(window.location.href);

    url.searchParams.set("room", roomIdInput.value.trim());

    return url.toString();
}

async function copyInviteLink() {
    const inviteLink = getInviteLink();

    try {
        await navigator.clipboard.writeText(inviteLink);

        inviteStatus.textContent = "Lien copié !";
    }
    catch (error) {
        console.error(error);

        prompt("Copie ce lien :", inviteLink);
    }
}

function getRoomFromUrl() {
    const params = new URLSearchParams(window.location.search);

    return params.get("room");
}

function sendToHost(type, data = {}) {
    if (hostConnection && hostConnection.open) {
        hostConnection.send({
            type,
            data
        });
    }
}

function sendToAll(type, data = {}) {
    connections.forEach(connection => {
        if (connection.open) {
            connection.send({
                type,
                data
            });
        }
    });
}

function sendToOne(connection, type, data = {}) {
    if (connection && connection.open) {
        connection.send({
            type,
            data
        });
    }
}

function updateLocalPlayer() {
    const player = players.find(item => item.id === localPlayerId);

    if (!player) {
        return;
    }

    player.clicks = clicks;
    player.seconds = seconds;
    player.currentPage = currentPage;
}

// ---------------------
// Validation article
// ---------------------

function isValidWikiArticle(title) {
    if (!title) {
        return false;
    }

    if (title.startsWith("#")) {
        return false;
    }

    if (title.includes(":")) {
        return false;
    }

    for (const prefix of FORBIDDEN_PREFIXES) {
        if (title.startsWith(prefix)) {
            return false;
        }
    }

    return true;
}

// ---------------------
// Tirage article
// ---------------------

function randomCasualPage() {
    return CASUAL_PAGES[
        Math.floor(Math.random() * CASUAL_PAGES.length)
    ];
}

// ---------------------
// Timer
// ---------------------

function startTimer() {
    clearInterval(timer);

    seconds = 0;

    document.getElementById("timer").textContent = "0 s";

    timer = setInterval(() => {
        seconds++;

        document.getElementById("timer").textContent = seconds + " s";

        sendProgress();
    }, 1000);
}

function stopTimer() {
    clearInterval(timer);
}

// ---------------------
// Progression
// ---------------------

function sendProgress() {
    if (!gameStarted) {
        return;
    }

    updateLocalPlayer();

    if (isHost) {
        broadcastRoomUpdate();
    }
    else {
        sendToHost("player:progress", {
            id: localPlayerId,
            currentPage,
            clicks,
            seconds
        });
    }
}

// ---------------------
// Victoire
// ---------------------

function checkVictory() {
    if (currentPage === targetPage && gameStarted) {
        stopTimer();

        gameStarted = false;

        const player = players.find(item => item.id === localPlayerId);

        if (player) {
            player.finished = true;
            player.clicks = clicks;
            player.seconds = seconds;
            player.currentPage = currentPage;
        }

        if (isHost) {
            sendToAll("game:winner", {
                nickname: localNickname,
                clicks,
                seconds
            });

            broadcastRoomUpdate();
        }
        else {
            sendToHost("player:victory", {
                id: localPlayerId,
                clicks,
                seconds
            });
        }

        alert(
            "🏆 Victoire !\n\n" +
            "Temps : " + seconds + " s\n" +
            "Clics : " + clicks
        );
    }
}

// ---------------------
// Charger article
// ---------------------

async function loadArticle(title) {
    currentPage = title;

    try {
        const response = await fetch(
            "https://fr.wikipedia.org/api/rest_v1/page/html/" +
            encodeURIComponent(title)
        );

        if (!response.ok) {
            throw new Error("Article introuvable");
        }

        const html = await response.text();

        const article = document.getElementById("article");

        article.innerHTML = html;

        rewriteLinks();

        sendProgress();

        checkVictory();

        window.scrollTo(0, 0);
    }
    catch (error) {
        console.error(error);

        document.getElementById("article").innerHTML =
            "<h2>Erreur lors du chargement</h2>" +
            "<p>Vérifie que tu utilises Live Server ou GitHub Pages, pas file://.</p>";
    }
}

// ---------------------
// Réécriture liens
// ---------------------

function rewriteLinks() {
    const links = document.querySelectorAll("#article a");

    links.forEach(link => {
        const href = link.getAttribute("href");

        if (!href) {
            return;
        }

        if (!href.startsWith("./")) {
            link.style.color = "#999";
            link.style.pointerEvents = "none";
            return;
        }

        let page = href.replace("./", "");

        page = page.split("#")[0];

        page = decodeURIComponent(page);

        if (!isValidWikiArticle(page)) {
            link.style.color = "#999";
            link.style.textDecoration = "line-through";
            link.style.pointerEvents = "none";
            return;
        }

        link.addEventListener("click", event => {
            event.preventDefault();

            if (!gameStarted) {
                return;
            }

            clicks++;

            document.getElementById("clicks").textContent =
                clicks + " clics";

            loadArticle(page);
        });
    });
}

// ---------------------
// Affichage joueurs
// ---------------------

function renderPlayers() {
    playersContainer.innerHTML = "";

    players.forEach(player => {
        const card = document.createElement("div");

        card.className = "player-card";

        if (player.host) {
            card.classList.add("host");
        }

        if (player.finished) {
            card.classList.add("finished");
        }

        let text = player.nickname;

        if (player.host) {
            text += " 👑";
        }

        text += " — " + player.clicks + " clics";

        if (player.currentPage) {
            text += " — " + player.currentPage;
        }

        if (player.finished) {
            text += " ✅";
        }

        card.textContent = text;

        playersContainer.appendChild(card);
    });
}

// ---------------------
// Synchronisation lobby
// ---------------------

function getRoomState() {
    return {
        players,
        startPage,
        targetPage,
        gameStarted
    };
}

function applyRoomState(state) {
    players = state.players || [];
    startPage = state.startPage || "";
    targetPage = state.targetPage || "";
    gameStarted = state.gameStarted || false;

    renderPlayers();
}

function broadcastRoomUpdate() {
    renderPlayers();

    sendToAll("room:update", getRoomState());
}

// ---------------------
// Création lobby
// ---------------------

createRoomButton.addEventListener("click", () => {
    isHost = true;
    localNickname = getNickname();

    peer = new Peer();

    peerStatus.textContent = "Création du lobby...";

    peer.on("open", id => {
console.log("Lobby créé :", id);
        localPlayerId = id;

        players = [
            {
                id: localPlayerId,
                nickname: localNickname,
                clicks: 0,
                seconds: 0,
                currentPage: "",
                finished: false,
                host: true
            }
        ];

        peerStatus.textContent = "Lobby créé";
        roomIdDisplay.textContent = "ID : " + id;
        roomIdInput.value = id;

        copyInviteButton.disabled = false;
        newGameButton.disabled = false;

        renderPlayers();
    });

    peer.on("connection", connection => {
        if (connections.length >= 9) {
            sendToOne(connection, "room:full");
            connection.close();
            return;
        }

        connections.push(connection);

        connection.on("data", message => {
            handleHostMessage(connection, message);
        });

        connection.on("close", () => {
            connections = connections.filter(item => item !== connection);

            players = players.filter(player => player.connectionId !== connection.connectionId);

            broadcastRoomUpdate();
        });
    });

    peer.on("error", error => {
        console.error(error);
        peerStatus.textContent = "Erreur PeerJS";
    });
});

// ---------------------
// Copier invitation
// ---------------------

copyInviteButton.addEventListener("click", copyInviteLink);

// ---------------------
// Rejoindre lobby
// ---------------------

function joinRoom(roomIdFromLink = "") {
    const roomId = roomIdFromLink || roomIdInput.value.trim();

    if (!roomId) {
        alert("Entre l'ID du lobby.");
        return;
    }

    isHost = false;
    localNickname = getNickname();

    peer = new Peer();

    peerStatus.textContent = "Connexion au lobby...";

    peer.on("open", id => {
        localPlayerId = id;

        hostConnection = peer.connect(roomId, {
            reliable: true
        });

        hostConnection.on("open", () => {
            peerStatus.textContent = "Connecté au lobby";
            roomIdDisplay.textContent = "ID : " + roomId;
            roomIdInput.value = roomId;

            sendToHost("player:join", {
                id: localPlayerId,
                nickname: localNickname
            });
        });

        hostConnection.on("data", message => {
            handleClientMessage(message);
        });

        hostConnection.on("close", () => {
            peerStatus.textContent = "Déconnecté du lobby";
            gameStarted = false;
            stopTimer();
        });
    });

    peer.on("error", error => {
        console.error(error);
        peerStatus.textContent = "Erreur PeerJS";
    });
}

joinRoomButton.addEventListener("click", () => {
    joinRoom();
});

// ---------------------
// Messages côté hôte
// ---------------------

function handleHostMessage(connection, message) {
    const type = message.type;
    const data = message.data || {};

    if (type === "player:join") {
        const exists = players.some(player => player.id === data.id);

        if (!exists) {
            connection.connectionId = data.id;

            players.push({
                id: data.id,
                connectionId: data.id,
                nickname: data.nickname || "Joueur",
                clicks: 0,
                seconds: 0,
                currentPage: "",
                finished: false,
                host: false
            });
        }

        sendToOne(connection, "room:update", getRoomState());
        broadcastRoomUpdate();
    }

    if (type === "player:progress") {
        const player = players.find(item => item.id === data.id);

        if (player) {
            player.currentPage = data.currentPage;
            player.clicks = data.clicks;
            player.seconds = data.seconds;
        }

        broadcastRoomUpdate();
    }

    if (type === "player:victory") {
        const player = players.find(item => item.id === data.id);

        if (player) {
            player.finished = true;
            player.clicks = data.clicks;
            player.seconds = data.seconds;
        }

        sendToAll("game:winner", {
            nickname: player ? player.nickname : "Un joueur",
            clicks: data.clicks,
            seconds: data.seconds
        });

        broadcastRoomUpdate();
    }
}

// ---------------------
// Messages côté client
// ---------------------

function handleClientMessage(message) {
    const type = message.type;
    const data = message.data || {};

    if (type === "room:full") {
        alert("Le lobby est complet.");
        return;
    }

    if (type === "room:update") {
        applyRoomState(data);
    }

    if (type === "game:start") {
        startClientGame(data);
    }

    if (type === "game:winner") {
        gameStarted = false;
        stopTimer();

        alert(
            "🏆 " + data.nickname + " a gagné !\n\n" +
            "Temps : " + data.seconds + " s\n" +
            "Clics : " + data.clicks
        );
    }
}

// ---------------------
// Nouvelle partie hôte
// ---------------------

function newGame() {
    if (!isHost) {
        alert("Seul l'hôte peut lancer la partie.");
        return;
    }

    startPage = randomCasualPage();

    do {
        targetPage = randomCasualPage();
    }
    while (targetPage === startPage);

    gameStarted = true;

    players.forEach(player => {
        player.clicks = 0;
        player.seconds = 0;
        player.currentPage = startPage;
        player.finished = false;
    });

    clicks = 0;
    seconds = 0;
    currentPage = startPage;

    document.getElementById("clicks").textContent = "0 clic";
    document.getElementById("timer").textContent = "0 s";

    document.getElementById("start").textContent =
        "Départ : " + startPage;

    document.getElementById("target").textContent =
        "Objectif : " + targetPage;

    document.getElementById("article").innerHTML =
        "<h2>Chargement de la partie...</h2>";

    sendToAll("game:start", {
        startPage,
        targetPage
    });

    broadcastRoomUpdate();

    startTimer();

    loadArticle(startPage);
}

newGameButton.addEventListener("click", newGame);

// ---------------------
// Début partie client
// ---------------------

function startClientGame(data) {
    startPage = data.startPage;
    targetPage = data.targetPage;
    currentPage = startPage;

    clicks = 0;
    seconds = 0;
    gameStarted = true;

    document.getElementById("clicks").textContent = "0 clic";
    document.getElementById("timer").textContent = "0 s";

    document.getElementById("start").textContent =
        "Départ : " + startPage;

    document.getElementById("target").textContent =
        "Objectif : " + targetPage;

    document.getElementById("article").innerHTML =
        "<h2>Chargement de la partie...</h2>";

    startTimer();

    loadArticle(startPage);
}

// ---------------------
// Connexion automatique via lien
// ---------------------

window.addEventListener("load", () => {
    const roomFromUrl = getRoomFromUrl();

    if (roomFromUrl) {
        roomIdInput.value = roomFromUrl;
        peerStatus.textContent = "Lien d'invitation détecté. Clique sur Rejoindre.";
    }
});