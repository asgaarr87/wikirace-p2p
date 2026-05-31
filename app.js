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
let localFinished = false;

let localPlayerId = "";
let localNickname = "";
let playerPath = [];

let players = [];

const nameScreen = document.getElementById("nameScreen");
const gameScreen = document.getElementById("gameScreen");
const nicknameInput = document.getElementById("nicknameInput");
const confirmNicknameButton = document.getElementById("confirmNickname");
const nicknameDisplay = document.getElementById("nicknameDisplay");
const nameHint = document.getElementById("nameHint");

const roomIdInput = document.getElementById("roomIdInput");
const createRoomButton = document.getElementById("createRoom");
const joinRoomButton = document.getElementById("joinRoom");
const copyInviteButton = document.getElementById("copyInvite");
const newGameButton = document.getElementById("newGame");
const restartGameButton = document.getElementById("restartGame");
const peerStatus = document.getElementById("peerStatus");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const inviteStatus = document.getElementById("inviteStatus");
const playersContainer = document.getElementById("players");

function getRoomFromUrl() {
    return new URLSearchParams(window.location.search).get("room");
}

function showGameScreen() {
    nameScreen.style.display = "none";
    gameScreen.classList.remove("hidden");
    gameScreen.style.display = "block";

    nicknameDisplay.textContent = "Pseudo : " + localNickname;

    window.scrollTo(0, 0);

    const roomFromUrl = getRoomFromUrl();

    if (roomFromUrl) {
        roomIdInput.value = roomFromUrl;
        peerStatus.textContent = "Lien d'invitation détecté. Clique sur Rejoindre.";
    }
}

function confirmNickname() {
    const nickname = nicknameInput.value.trim();

    if (!nickname) {
        nameHint.textContent = "Choisis un pseudo pour continuer.";
        return;
    }

    localNickname = nickname;
    showGameScreen();
}

confirmNicknameButton.addEventListener("click", confirmNickname);

nicknameInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        confirmNickname();
    }
});

function getInviteLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomIdInput.value.trim());
    return url.toString();
}

async function copyInviteLink() {
    const link = getInviteLink();

    try {
        await navigator.clipboard.writeText(link);
        inviteStatus.textContent = "Lien copié !";
    }
    catch {
        prompt("Copie ce lien :", link);
    }
}

function sendToHost(type, data = {}) {
    if (hostConnection && hostConnection.open) {
        hostConnection.send({ type, data });
    }
}

function sendToAll(type, data = {}) {
    connections.forEach(connection => {
        if (connection.open) {
            connection.send({ type, data });
        }
    });
}

function sendToOne(connection, type, data = {}) {
    if (connection && connection.open) {
        connection.send({ type, data });
    }
}

function isValidWikiArticle(title) {
    if (!title) return false;
    if (title.startsWith("#")) return false;
    if (title.includes(":")) return false;

    for (const prefix of FORBIDDEN_PREFIXES) {
        if (title.startsWith(prefix)) return false;
    }

    return true;
}

function randomCasualPage() {
    return CASUAL_PAGES[Math.floor(Math.random() * CASUAL_PAGES.length)];
}

function startTimer() {
    clearInterval(timer);

    seconds = 0;
    document.getElementById("timer").textContent = "0 s";

    timer = setInterval(() => {
        if (localFinished) return;

        seconds++;
        document.getElementById("timer").textContent = seconds + " s";
        sendProgress();
    }, 1000);
}

function stopTimer() {
    clearInterval(timer);
}

function updateLocalPlayer() {
    const player = players.find(item => item.id === localPlayerId);

    if (!player) return;

    player.clicks = clicks;
    player.seconds = seconds;
    player.currentPage = currentPage;
    player.finished = localFinished;
    player.path = playerPath;
}

function sendProgress() {
    if (!gameStarted) return;

    updateLocalPlayer();

    if (isHost) {
        broadcastRoomUpdate();
        checkAllFinished();
    }
    else {
        sendToHost("player:progress", {
            id: localPlayerId,
            currentPage,
            clicks,
            seconds,
            finished: localFinished,
            path: playerPath
        });
    }
}

function checkVictory() {
    if (currentPage === targetPage && gameStarted && !localFinished) {
        localFinished = true;
        stopTimer();
        sendProgress();

        if (isHost) {
            checkAllFinished();
        }
        else {
            sendToHost("player:victory", {
                id: localPlayerId,
                clicks,
                seconds,
                path: playerPath
            });
        }

        alert(
            "🏆 Tu as trouvé le mot !\n\n" +
            "Temps : " + seconds + " s\n" +
            "Clics : " + clicks + "\n\n" +
            "Les autres joueurs peuvent continuer."
        );
    }
}

function checkAllFinished() {
    if (!isHost || !gameStarted) return;
    if (players.length === 0) return;

    const everyoneFinished = players.every(player => player.finished);

    if (everyoneFinished) {
        gameStarted = false;
        sendToAll("game:finished", { players });
        showFinalResults(players);
        broadcastRoomUpdate();
    }
}

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
            "<p>Vérifie que tu utilises Live Server ou GitHub Pages.</p>";
    }
}

function rewriteLinks() {
    const links = document.querySelectorAll("#article a");

    links.forEach(link => {
        const href = link.getAttribute("href");

        if (!href) return;

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

            if (!gameStarted || localFinished) return;

            clicks++;

            document.getElementById("clicks").textContent =
                clicks + " clics";

            playerPath.push(page);

            loadArticle(page);
        });
    });
}

function renderPlayers() {
    playersContainer.innerHTML = "";

    players.forEach(player => {
        const card = document.createElement("div");

        card.className = "player-card";

        if (player.host) card.classList.add("host");
        if (player.finished) card.classList.add("finished");

        let text = player.nickname;

        if (player.host) text += " 👑";

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

function showFinalResults(finalPlayers) {
    const sortedPlayers = [...finalPlayers].sort((a, b) => {
        if (a.seconds !== b.seconds) return a.seconds - b.seconds;
        return a.clicks - b.clicks;
    });

    let html = "<div class='results'>";
    html += "<h2>🏁 Résultats de la partie</h2>";
    html += "<p><strong>Départ :</strong> " + startPage + "</p>";
    html += "<p><strong>Objectif :</strong> " + targetPage + "</p>";

    sortedPlayers.forEach((player, index) => {
        html += "<div class='result-card'>";
        html += "<h3>#" + (index + 1) + " — " + player.nickname + "</h3>";
        html += "<p>" + player.seconds + " s — " + player.clicks + " clics</p>";
        html += "<div class='path'>";

        const path = player.path || [];

        path.forEach((page, pageIndex) => {
            html += page;

            if (pageIndex < path.length - 1) {
                html += " → ";
            }
        });

        html += "</div>";
        html += "</div>";
    });

    html += "</div>";

    document.getElementById("article").innerHTML = html;
}

createRoomButton.addEventListener("click", () => {
    isHost = true;

    peer = new Peer();

    peerStatus.textContent = "Création du lobby...";

    peer.on("open", id => {
        localPlayerId = id;

        players = [
            {
                id: localPlayerId,
                nickname: localNickname,
                clicks: 0,
                seconds: 0,
                currentPage: "",
                finished: false,
                host: true,
                path: []
            }
        ];

        peerStatus.textContent = "Lobby créé";
        roomIdDisplay.textContent = "ID : " + id;
        roomIdInput.value = id;

        copyInviteButton.disabled = false;
        newGameButton.disabled = false;
        restartGameButton.disabled = false;

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
            checkAllFinished();
        });
    });

    peer.on("error", error => {
        console.error(error);
        peerStatus.textContent = "Erreur PeerJS";
    });
});

copyInviteButton.addEventListener("click", copyInviteLink);

function joinRoom(roomIdFromLink = "") {
    const roomId = roomIdFromLink || roomIdInput.value.trim();

    if (!roomId) {
        alert("Entre l'ID du lobby.");
        return;
    }

    isHost = false;

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
                host: false,
                path: []
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
            player.finished = data.finished;
            player.path = data.path || [];
        }

        broadcastRoomUpdate();
        checkAllFinished();
    }

    if (type === "player:victory") {
        const player = players.find(item => item.id === data.id);

        if (player) {
            player.finished = true;
            player.clicks = data.clicks;
            player.seconds = data.seconds;
            player.path = data.path || [];
        }

        sendToAll("player:found", {
            nickname: player ? player.nickname : "Un joueur",
            clicks: data.clicks,
            seconds: data.seconds
        });

        broadcastRoomUpdate();
        checkAllFinished();
    }
}

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

    if (type === "player:found") {
        alert(
            "✅ " + data.nickname + " a trouvé le mot !\n\n" +
            "Temps : " + data.seconds + " s\n" +
            "Clics : " + data.clicks + "\n\n" +
            "La partie continue pour les autres."
        );
    }

    if (type === "game:finished") {
        gameStarted = false;
        stopTimer();
        showFinalResults(data.players || []);
    }
}

function startNewRound() {
    if (!isHost) {
        alert("Seul l'hôte peut lancer ou restart la partie.");
        return;
    }

    startPage = randomCasualPage();

    do {
        targetPage = randomCasualPage();
    }
    while (targetPage === startPage);

    gameStarted = true;
    localFinished = false;

    players.forEach(player => {
        player.clicks = 0;
        player.seconds = 0;
        player.currentPage = startPage;
        player.finished = false;
        player.path = [startPage];
    });

    clicks = 0;
    seconds = 0;
    currentPage = startPage;
    playerPath = [startPage];

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

newGameButton.addEventListener("click", startNewRound);
restartGameButton.addEventListener("click", startNewRound);

function startClientGame(data) {
    startPage = data.startPage;
    targetPage = data.targetPage;
    currentPage = startPage;

    clicks = 0;
    seconds = 0;
    gameStarted = true;
    localFinished = false;
    playerPath = [startPage];

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

window.addEventListener("load", () => {
    const roomFromUrl = getRoomFromUrl();

    if (roomFromUrl) {
        nameHint.textContent = "Lien d'invitation détecté. Entre ton pseudo pour rejoindre.";
    }
});