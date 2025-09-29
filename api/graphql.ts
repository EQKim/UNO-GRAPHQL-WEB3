// api/graphql.ts
import { createSchema, createYoga } from "graphql-yoga";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin using a service account JSON from an env var
if (!getApps().length) {
  const key = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error("Missing GCP_SERVICE_ACCOUNT_KEY");
  initializeApp({ credential: cert(JSON.parse(key)) });
}
const db = getFirestore();

// --- Define your schema (simplified; tweak as you need) ---
const typeDefs = /* GraphQL */ `
  scalar JSON

  type Player { id: ID!, displayName: String!, isHost: Boolean }
  type Room {
    id: ID!
    code: String
    status: String!
    currentTurn: String
    hostUid: String
    winnerUid: String
    topCard: JSON
    pendingType: String
    pendingDraw: Int
    chainPlayer: String
    chainValue: Int
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

const resolvers = {
  Query: {
    async room(_: unknown, { id }: { id: string }) {
      const doc = await db.doc(`rooms/${id}`).get();
      if (!doc.exists) return null;
      const playersSnap = await db.collection(`rooms/${id}/players`).get();
      const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      return { id, ...doc.data(), players };
    }
  },
  Mutation: {
    async startGame(_: unknown, { roomId }: { roomId: string }) {
      await db.doc(`rooms/${roomId}`).update({ status: "playing" });
      return true;
    },
    async playCard(_: unknown, { roomId, card }: { roomId: string; card: any }) {
      await db.collection(`rooms/${roomId}/actions`).add({ type: "playCard", card, ts: Date.now() });
      return true;
    },
    async drawOne(_: unknown, { roomId }: { roomId: string }) {
      await db.collection(`rooms/${roomId}/actions`).add({ type: "drawOne", ts: Date.now() });
      return true;
    },
    async endTurn(_: unknown, { roomId }: { roomId: string }) {
      await db.collection(`rooms/${roomId}/actions`).add({ type: "endTurn", ts: Date.now() });
      return true;
    }
  }
};

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/api/graphql",
  cors: {
    origin: [
      "http://localhost:5173",     // Vite dev
      "https://eqkim.github.io"    // your GitHub Pages origin (host only)
    ],
    credentials: false
  }
});

export default yoga;
export const config = { api: { bodyParser: false } }; // Vercel config
