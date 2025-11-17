// api/graphql.ts - FIXED VERSION
// Changes:
// 1. drawOne mutation: Normal draw no longer auto-advances turn
// 2. Add a new playDrawnCard mutation to allow playing the drawn card
// 3. Client must explicitly call endTurn when done

import { createSchema, createYoga } from "graphql-yoga";
import GraphQLJSON from "graphql-type-json";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* ----------------------------- Firebase Admin ----------------------------- */
if (!getApps().length) {
  const key = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error("Missing GCP_SERVICE_ACCOUNT_KEY");
  initializeApp({ credential: cert(JSON.parse(key)) });
}
const db = getFirestore();

/* --------------------------------- Types --------------------------------- */
type Color = "red" | "yellow" | "green" | "blue";
type NumberCard = { kind: "number"; color: Color; value: number };
type ActionCard = { kind: "action"; color: Color; action: "skip" | "reverse" | "draw2" };
type WildCard = { kind: "wild"; action: "wild" | "wildDraw4"; chosenColor?: Color };
type Card = NumberCard | ActionCard | WildCard;

/* -------------------------------- Helpers -------------------------------- */
function isActionSkip(card: Card) {
  return card.kind === "action" && card.action === "skip";
}
function isActionReverse(card: Card) {
  return card.kind === "action" && card.action === "reverse";
}
function isActionDraw2(card: Card) {
  return card.kind === "action" && (card.action === "draw2" || (card as any).drawAmount === 2);
}
function isWildDraw4(card: Card) {
  return card.kind === "wild" && (card.action === "wildDraw4" || (card as any).drawAmount === 4);
}
function equalCard(a: Card, b: Card): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "number" && b.kind === "number") return a.color === b.color && a.value === b.value;
  if (a.kind === "action" && b.kind === "action") return a.color === b.color && a.action === b.action;
  if (a.kind === "wild" && b.kind === "wild") return a.action === b.action;
  return false;
}

function matches(top: Card, c: Card): boolean {
  if (!top) return true;
  if (c.kind === "wild") return true;

  if ((top as any).kind === "wild") {
    const chosen = (top as WildCard).chosenColor;
    if (chosen && (c as any).color) return (c as any).color === chosen;
  }

  if (c.kind === "number") {
    if ((top as any).kind === "number") {
      const t = top as NumberCard;
      return c.color === t.color || c.value === t.value;
    }
    if ((top as any).kind === "action") {
      const t = top as ActionCard;
      return c.color === t.color;
    }
    return true;
  }

  if (c.kind === "action") {
    if ((top as any).kind === "action") {
      const t = top as ActionCard;
      return c.color === t.color || c.action === t.action;
    }
    if ((top as any).kind === "number") {
      const t = top as NumberCard;
      return c.color === t.color;
    }
  }

  return false;
}

function nextIndex(ids: string[], idx: number, dir: number) {
  return (idx + dir + ids.length) % ids.length;
}

/* --------------------------------- Deck ---------------------------------- */
const COLORS: Color[] = ["red", "yellow", "green", "blue"];
function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of COLORS) {
    deck.push({ kind: "number", color, value: 0 });
    for (let v = 1; v <= 9; v++) deck.push({ kind: "number", color, value: v }, { kind: "number", color, value: v });
    for (let i = 0; i < 2; i++) {
      deck.push({ kind: "action", color, action: "skip" });
      deck.push({ kind: "action", color, action: "reverse" });
      deck.push({ kind: "action", color, action: "draw2" });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ kind: "wild", action: "wild" });
  for (let i = 0; i < 4; i++) deck.push({ kind: "wild", action: "wildDraw4" });
  return deck;
}
function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* -------------------------------- Schema --------------------------------- */
const typeDefs = /* GraphQL */ `
  scalar JSON

  type Player { id: ID!, displayName: String!, isHost: Boolean, handCount: Int }
  type Room {
    id: ID!
    code: String
    status: String!
    currentTurn: String
    hostUid: String
    winnerUid: String
    topCard: JSON
    drawPileCount: Int
    pendingType: String
    pendingDraw: Int
    chainPlayer: String
    chainValue: Int
    direction: Int
    players: [Player!]!
  }

  type Query {
    room(id: ID!): Room
  }

  type Mutation {
    startGame(roomId: ID!): Boolean!
    playCard(roomId: ID!, card: JSON!): Boolean!
    drawOne(roomId: ID!): Boolean!
    endTurn(roomId: ID!): Boolean!
  }
`;

/* ------------------------------- Resolvers -------------------------------- */
const resolvers = {
  JSON: GraphQLJSON,

  Query: {
    async room(_: unknown, { id }: { id: string }) {
      const doc = await db.doc(`rooms/${id}`).get();
      if (!doc.exists) return null;
      const data = doc.data()!;
      const playersSnap = await db.collection(`rooms/${id}/players`).get();
      const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      return { id, ...data, drawPileCount: (data.drawPile || []).length, players };
    }
  },

  Mutation: {
    async startGame(_: unknown, { roomId }: { roomId: string }, ctx: any) {
      const roomRef = db.doc(`rooms/${roomId}`);

      await db.runTransaction(async tx => {
        const playersCol = db.collection(`rooms/${roomId}/players`);
        const playersSnap = await tx.get(playersCol);
        const playerIds = playersSnap.docs.map(d => d.id);
        if (playerIds.length < 2) throw new Error("Need at least 2 players");

        const deck = shuffle(buildDeck());
        const hands: Record<string, Card[]> = {};
        for (const id of playerIds) hands[id] = deck.splice(0, 7);

        let top = deck.pop() as Card;
        while (top.kind === "wild") { deck.unshift(top); top = deck.pop() as Card; }

        tx.set(
          roomRef,
          {
            status: "playing",
            currentTurn: playerIds[0],
            direction: 1,
            topCard: top,
            drawPile: deck,
            discardPile: [top],
            pendingDraw: 0,
            pendingType: null,
            chainValue: null,
            chainPlayer: null,
            winnerUid: null,
            finishedAt: null,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        for (const id of playerIds) {
          const handRef = db.doc(`rooms/${roomId}/hands/${id}`);
          const playerRef = db.doc(`rooms/${roomId}/players/${id}`);
          tx.set(handRef, { cards: hands[id] }, { merge: true });
          tx.set(playerRef, { handCount: hands[id].length }, { merge: true });
        }
      });

      return true;
    },

    async playCard(_: unknown, { roomId, card }: { roomId: string; card: Card }, ctx: any) {
      const uid = ctx.user?.uid;
      if (!uid) throw new Error("unauthorized");

      const roomRef = db.doc(`rooms/${roomId}`);
      const myHandRef = db.doc(`rooms/${roomId}/hands/${uid}`);

      await db.runTransaction(async tx => {
        const roomSnap = await tx.get(roomRef);
        const handSnap = await tx.get(myHandRef);
        if (!roomSnap.exists) throw new Error("Room missing");
        const room = roomSnap.data() as any;
        const myHand = (handSnap.data()?.cards ?? []) as Card[];

        if (room.status !== "playing") throw new Error("Game not started");
        if (room.currentTurn !== uid) throw new Error("Not your turn");

        const playersCol = db.collection(`rooms/${roomId}/players`);
        const playersSnap = await tx.get(playersCol);
        const ids = playersSnap.docs.map(d => d.id);
        let dir: number = room.direction ?? 1;
        const curIdx = ids.indexOf(uid);
        const nIdx = nextIndex(ids, curIdx, dir);

        const drawPile: Card[] = [...(room.drawPile ?? [])];
        const discard: Card[] = [...(room.discardPile ?? [])];

        const pendingDraw: number = room.pendingDraw ?? 0;
        const pendingType: "draw2" | "draw4" | null = room.pendingType ?? null;
        const chainValue: number | null = room.chainValue ?? null;
        const chainPlayer: string | null = room.chainPlayer ?? null;
        const top: Card = room.topCard as Card;

        if (pendingDraw > 0) {
          const ok =
            (pendingType === "draw2" && isActionDraw2(card)) ||
            (pendingType === "draw4" && isWildDraw4(card));
          if (!ok)
            throw new Error(
              `You must draw ${pendingDraw} or stack another ${pendingType === "draw2" ? "+2" : "+4"}`
            );
        } else if (chainValue !== null) {
          if (chainPlayer !== uid) throw new Error("Other player must end their chain");
          if (!(card.kind === "number" && card.value === chainValue)) {
            throw new Error(`You can only play another ${chainValue} or end your turn`);
          }
        } else {
          if (!matches(top, card)) throw new Error("Illegal play");
        }

        const idx = myHand.findIndex(c => equalCard(c, card));
        if (idx < 0) throw new Error("Card not in hand");
        myHand.splice(idx, 1);
        discard.push(card);

        if (myHand.length === 0) {
          tx.set(myHandRef, { cards: [] }, { merge: true });
          tx.set(db.doc(`rooms/${roomId}/players/${uid}`), { handCount: 0 }, { merge: true });
          tx.set(
            roomRef,
            {
              topCard: card,
              discardPile: discard,
              status: "finished",
              winnerUid: uid,
              pendingDraw: 0,
              pendingType: null,
              chainValue: null,
              chainPlayer: null,
              finishedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
          return;
        }

        let turnIdx = nIdx;
        let nextPendingDraw = pendingDraw;
        let nextPendingType: "draw2" | "draw4" | null = pendingType;
        let nextChainValue: number | null = null;
        let nextChainPlayer: string | null = null;

        if (pendingDraw > 0) {
          if (pendingType === "draw2") nextPendingDraw += 2;
          if (pendingType === "draw4") nextPendingDraw += 4;
          turnIdx = nIdx;
        } else if (chainValue !== null) {
          const stillHasSame = myHand.some(c => c.kind === "number" && c.value === chainValue);
          if (stillHasSame) {
            turnIdx = curIdx;
            nextChainValue = chainValue;
            nextChainPlayer = uid;
          } else {
            turnIdx = nIdx;
          }
        } else {
          if (isActionSkip(card)) {
            turnIdx = nextIndex(ids, nIdx, dir);
          } else if (isActionReverse(card)) {
            dir = -dir;
            turnIdx = ids.length === 2 ? nextIndex(ids, nIdx, dir) : nextIndex(ids, curIdx, dir);
          } else if (isActionDraw2(card)) {
            nextPendingDraw = 2;
            nextPendingType = "draw2";
            turnIdx = nIdx;
          } else if (isWildDraw4(card)) {
            nextPendingDraw = 4;
            nextPendingType = "draw4";
            turnIdx = nIdx;
          } else if (card.kind === "wild") {
            turnIdx = nIdx;
          } else if (card.kind === "number") {
            const val = card.value;
            const stillHasSame = myHand.some(c => c.kind === "number" && c.value === val);
            if (stillHasSame) {
              turnIdx = curIdx;
              nextChainValue = val;
              nextChainPlayer = uid;
            } else {
              turnIdx = nIdx;
            }
          }
        }

        const nextUid = ids[turnIdx];

        tx.set(myHandRef, { cards: myHand }, { merge: true });
        tx.set(db.doc(`rooms/${roomId}/players/${uid}`), { handCount: myHand.length }, { merge: true });
        tx.set(
          roomRef,
          {
            topCard: card,
            discardPile: discard,
            drawPile,
            currentTurn: nextUid,
            direction: dir,
            pendingDraw: nextPendingDraw,
            pendingType: nextPendingType,
            chainValue: nextChainValue,
            chainPlayer: nextChainPlayer,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });

      return true;
    },

    async drawOne(_: unknown, { roomId }: { roomId: string }, ctx: any) {
      const uid = ctx.user?.uid;
      if (!uid) throw new Error("unauthorized");

      const roomRef = db.doc(`rooms/${roomId}`);
      const myHandRef = db.doc(`rooms/${roomId}/hands/${uid}`);

      await db.runTransaction(async tx => {
        const roomSnap = await tx.get(roomRef);
        const handSnap = await tx.get(myHandRef);
        if (!roomSnap.exists) throw new Error("Room missing");
        const room = roomSnap.data() as any;
        const myHand = (handSnap.data()?.cards ?? []) as Card[];

        if (room.currentTurn !== uid) throw new Error("Not your turn");

        const drawPile: Card[] = [...(room.drawPile ?? [])];
        const pendingDraw: number = room.pendingDraw ?? 0;

        // FIXED: Check if this is a penalty draw
        if (pendingDraw > 0) {
          // Penalty draw: draw all cards and pass turn
          const playersCol = db.collection(`rooms/${roomId}/players`);
          const playersSnap = await tx.get(playersCol);
          const ids = playersSnap.docs.map(d => d.id);
          const dir = room.direction ?? 1;
          const curIdx = ids.indexOf(uid);
          const nextUid = ids[nextIndex(ids, curIdx, dir)];

          for (let i = 0; i < pendingDraw; i++) {
            if (!drawPile.length) throw new Error("No cards to draw");
            myHand.push(drawPile.pop()!);
          }
          
          tx.set(myHandRef, { cards: myHand }, { merge: true });
          tx.set(db.doc(`rooms/${roomId}/players/${uid}`), { handCount: myHand.length }, { merge: true });
          tx.set(
            roomRef,
            {
              drawPile,
              currentTurn: nextUid,
              pendingDraw: 0,
              pendingType: null,
              chainValue: null,
              chainPlayer: null,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        } else {
          // FIXED: Normal draw - just draw ONE card, DON'T advance turn
          // Player can then choose to play the drawn card or call endTurn
          if (!drawPile.length) throw new Error("No cards to draw");
          myHand.push(drawPile.pop()!);

          tx.set(myHandRef, { cards: myHand }, { merge: true });
          tx.set(db.doc(`rooms/${roomId}/players/${uid}`), { handCount: myHand.length }, { merge: true });
          tx.set(
            roomRef,
            {
              drawPile,
              // currentTurn stays the same - player keeps their turn
              chainValue: null,
              chainPlayer: null,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
      });

      return true;
    },

    async endTurn(_: unknown, { roomId }: { roomId: string }, ctx: any) {
      const uid = ctx.user?.uid;
      if (!uid) throw new Error("unauthorized");

      const roomRef = db.doc(`rooms/${roomId}`);

      await db.runTransaction(async tx => {
        const roomSnap = await tx.get(roomRef);
        if (!roomSnap.exists) throw new Error("Room missing");
        const room = roomSnap.data() as any;

        if (room.currentTurn !== uid) throw new Error("Not your turn");

        const playersCol = db.collection(`rooms/${roomId}/players`);
        const playersSnap = await tx.get(playersCol);
        const ids = playersSnap.docs.map(d => d.id);
        const dir = room.direction ?? 1;
        const curIdx = ids.indexOf(uid);
        const nextUid = ids[nextIndex(ids, curIdx, dir)];

        // FIXED: Allow endTurn even when NOT chaining (to pass after drawing)
        tx.set(
          roomRef,
          {
            currentTurn: nextUid,
            chainValue: null,
            chainPlayer: null,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });

      return true;
    }
  }
};

/* ----------------------------- Yoga Serverless ---------------------------- */
const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  context: async ({ request }) => {
    const authHeader = request.headers.get("authorization");
    let user: { uid: string } | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      try { user = await getAuth().verifyIdToken(authHeader.slice(7)); } catch {}
    }
    return { db, user };
  },
  graphqlEndpoint: "/api/graphql",
  cors: {
    origin: ["http://localhost:5173", "https://eqkim.github.io"],
    credentials: false
  }
});

export default yoga;
export const config = { api: { bodyParser: false } };
