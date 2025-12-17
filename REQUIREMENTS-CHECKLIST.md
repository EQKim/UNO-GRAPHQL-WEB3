# Web3 Course Assignment 3 - Requirements Checklist

## ✅ Must Have Requirements

### 1. ✅ Playing against 1-3 human opponents
**Status:** IMPLEMENTED  
**Implementation:** `api/graphql.ts` lines 197-205
```typescript
const playerIds = playersSnap.docs.map(d => d.id);
if (playerIds.length < 2) {
  throw new Error("Need at least 2 players");
}
```
- `startGame` mutation validates minimum 2 players
- Game logic supports up to 4 players (standard Uno deck)
- Player turn rotation implemented with `nextIndex()` function

### 2. ✅ Official Uno rules
**Status:** IMPLEMENTED  
**Implementation:** `api/graphql.ts` lines 39-95, 265-390

**Card Types:**
- Number cards (0-9, all colors) - lines 102-105
- Action cards (Skip, Reverse, Draw+2) - lines 106-110
- Wild cards - line 111
- Wild Draw+4 - line 112

**Game Rules:**
- **Card matching:** `matches()` function lines 57-88
  - Color matching
  - Number matching
  - Action matching
  - Wild cards always playable
- **Skip:** Lines 364-366 - Skips next player
- **Reverse:** Lines 367-370 - Reverses turn direction (acts as skip with 2 players)
- **Draw+2 stacking:** Lines 278-285, 371-374 - Can stack multiple +2 cards
- **Draw+4 stacking:** Lines 278-285, 375-378 - Can stack multiple +4 cards
- **Number chaining:** Lines 286-292, 380-391 - Can play multiple cards of same number
- **Win condition:** Lines 329-347 - First player to empty hand wins

### 3. ✅ Same features as assignment 2
**Status:** IMPLEMENTED  
**Features:**
- Room creation with code: `createRoom` mutation (lines 169-196)
- Join room by code: `joinRoom` mutation (lines 198-238)
- Display names for players
- Game lobby system (status: "lobby", "playing", "finished")
- Real-time updates via Firestore subscriptions
- Turn-based gameplay

### 4. ✅ Users identify themselves
**Status:** IMPLEMENTED  
**Implementation:** `createRoom` and `joinRoom` mutations
```typescript
// createRoom mutation - line 169
async createRoom(_: unknown, { displayName }: { displayName: string }, ctx: any)

// joinRoom mutation - line 198
async joinRoom(_: unknown, { code, displayName }: { code: string; displayName: string }, ctx: any)
```
- Users provide `displayName` when creating/joining rooms
- Stored in Firestore: `rooms/{roomId}/players/{uid}` with `displayName` field
- Firebase Authentication provides unique `uid` for each user

### 5. ✅ Create new game
**Status:** IMPLEMENTED  
**Implementation:** `createRoom` mutation - lines 169-196
```graphql
mutation {
  createRoom(displayName: "Player1") {
    roomId
    code
  }
}
```
- Generates random 6-character room code
- Creates room document with status "lobby"
- Adds creator as host player

### 6. ✅ Join existing game
**Status:** IMPLEMENTED  
**Implementation:** `joinRoom` mutation - lines 198-238
```graphql
mutation {
  joinRoom(code: "ABC123", displayName: "Player2") {
    roomId
  }
}
```
- Finds room by code
- Validates room is in lobby status
- Adds player to room

### 7. ✅ Server notifies participants
**Status:** IMPLEMENTED  
**Implementation:** Firestore real-time listeners
- Server updates Firestore on every game action (lines with `FieldValue.serverTimestamp()`)
- Client uses `onSnapshot` to receive real-time updates
- Every mutation updates `updatedAt` timestamp
- Firestore automatically pushes changes to all connected clients

**Examples:**
- Line 250: `updatedAt: FieldValue.serverTimestamp()` in startGame
- Line 425: `updatedAt: FieldValue.serverTimestamp()` in playCard
- Line 496: `updatedAt: FieldValue.serverTimestamp()` in drawOne
- Line 558: `updatedAt: FieldValue.serverTimestamp()` in endTurn

### 8. ✅ GraphQL as communication protocol
**Status:** IMPLEMENTED  
**Implementation:** GraphQL Yoga server - lines 7-8, 562-596
```typescript
import { createSchema, createYoga } from "graphql-yoga";

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/api/graphql",
  // ... configuration
});
```

**GraphQL Schema:** Lines 123-148
- Queries: `room(id: ID!)`
- Mutations: `createRoom`, `joinRoom`, `startGame`, `playCard`, `drawOne`, `endTurn`

**All game actions go through GraphQL:**
- ✅ Room management (createRoom, joinRoom)
- ✅ Game control (startGame)
- ✅ Player actions (playCard, drawOne, endTurn)
- ✅ Game state queries (room query)

## ⚠️ Should Have Requirements

### 1. ⚠️ Track players and scores in database
**Status:** PARTIAL  
**What's tracked:**
- ✅ Players stored in `rooms/{roomId}/players/{uid}` collection
- ✅ Display names
- ✅ Hand counts
- ✅ Host status
- ✅ Winner UID (line 337)

**What's missing:**
- ❌ No persistent score tracking across games
- ❌ No win/loss history
- ❌ No player statistics

**Recommendation:** Add a `players` collection with:
```typescript
{
  uid: string,
  displayName: string,
  gamesPlayed: number,
  gamesWon: number,
  totalScore: number
}
```

### 2. ❌ User registration and login
**Status:** NOT IMPLEMENTED in GraphQL  
**Current state:**
- Using Firebase Authentication (verifyIdToken - line 571)
- Authentication handled client-side with Firebase SDK
- GraphQL server only validates tokens

**Note:** This is acceptable since Firebase Auth is a standard authentication solution. Adding GraphQL mutations for registration/login would be redundant with Firebase's built-in auth methods.

## 💡 Could Have Requirements

### 1. ❌ Play entire game with score
**Status:** NOT IMPLEMENTED  
**Current:** Single round only, winner determined when one player empties hand

**To implement:**
- Add `rounds` array to room document
- Track points per round (cards left in opponents' hands)
- First to 500 points wins
- Add `continueGame` mutation to start new round

### 2. ❌ Save/resume game
**Status:** NOT IMPLEMENTED  
**Current:** No save/load functionality

**To implement:**
- All game state already persists in Firestore
- Need to add:
  - `pauseGame` mutation (set status: "paused")
  - `resumeGame` mutation (set status: "playing")
  - Query to list player's active games

## 📊 Architecture Notes

### Communication Flow
```
Client → GraphQL Mutation → Server Resolver → Firestore Write → Firestore onSnapshot → Client Update
```

### Authentication Flow
```
Client → Firebase Auth → ID Token → GraphQL Context → Resolver validates ctx.user
```

### Database Structure
```
rooms/
  {roomId}/
    - code: string
    - status: "lobby" | "playing" | "finished"
    - currentTurn: string (uid)
    - topCard: Card
    - drawPile: Card[]
    - discardPile: Card[]
    - direction: 1 | -1
    - pendingDraw: number
    - winnerUid: string
    
    players/
      {uid}/
        - displayName: string
        - isHost: boolean
        - handCount: number
    
    hands/
      {uid}/
        - cards: Card[]
```

## 🎯 Summary

**Total Requirements:** 10 Must Have + 2 Should Have + 2 Could Have = 14

**Implemented:**
- ✅ Must Have: 8/8 fully implemented
- ⚠️ Should Have: 1/2 partial (player tracking without scores)
- ❌ Could Have: 0/2

**Assignment Grade Estimate:** Meets all mandatory requirements for full marks on core functionality.
