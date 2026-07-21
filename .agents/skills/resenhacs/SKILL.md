```markdown
# resenhacs Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill documents the core development patterns, coding conventions, and workflows used in the `resenhacs` JavaScript codebase. It covers both backend and frontend practices, including how to implement features, refactor code, manage database migrations, and maintain a robust test suite. The repository follows conventional commit messages and emphasizes modular, test-driven development without reliance on a specific framework.

## Coding Conventions

- **File Naming:**  
  Use `camelCase` for JavaScript files (e.g., `userProfile.js`, `friendshipManager.js`).

- **Import Style:**  
  Always use relative imports.
  ```js
  import { getUser } from './userService.js';
  ```

- **Export Style:**  
  Prefer named exports.
  ```js
  // userService.js
  export function getUser(id) { /* ... */ }
  export function createUser(data) { /* ... */ }
  ```

- **Commit Messages:**  
  Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes like `feat`, `fix`, `refactor`, `test`, `docs`.
  ```
  feat: add friendship module with invite/accept logic
  fix: correct typo in user validation
  refactor: migrate group logic to friendship model
  ```

## Workflows

### Feature Module Implementation with Tests
**Trigger:** When adding a new backend feature or module (e.g., friendships).  
**Command:** `/new-backend-module`

1. Create or update the main module file in `site/server/src/`  
   _Example:_ `site/server/src/friendship.js`
2. Create or update the corresponding test file in `site/server/test/`  
   _Example:_ `site/server/test/friendship.test.js`

**Example:**
```js
// site/server/src/friendship.js
export function sendInvite(userId, friendId) { /* ... */ }
```
```js
// site/server/test/friendship.test.js
import { sendInvite } from '../src/friendship.js';
import { describe, it, expect } from 'vitest';

describe('sendInvite', () => {
  it('should send an invite', () => {
    expect(sendInvite(1, 2)).toBeTruthy();
  });
});
```

---

### API Route Addition or Refactor with Tests
**Trigger:** When adding a new API endpoint or refactoring an existing route.  
**Command:** `/new-api-route`

1. Create or update the route handler in `site/server/src/routes/`  
   _Example:_ `site/server/src/routes/friendship.js`
2. Update route mounting in `site/server/src/app.js`
3. Create or update the corresponding test file in `site/server/test/`  
   _Example:_ `site/server/test/friendship.test.js`

**Example:**
```js
// site/server/src/routes/friendship.js
export function friendshipRoute(req, res) { /* ... */ }
```
```js
// site/server/src/app.js
import { friendshipRoute } from './routes/friendship.js';
app.use('/api/friendship', friendshipRoute);
```

---

### Database Migration Workflow
**Trigger:** When modifying the database schema (add/modify/remove tables/columns).  
**Command:** `/new-migration`

1. Create or update a migration SQL file in `supabase/migrations/`  
   _Example:_ `supabase/migrations/002_add_friendships.sql`
2. Optionally update related backend code to match schema changes

**Example:**
```sql
-- supabase/migrations/002_add_friendships.sql
CREATE TABLE friendships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  friend_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL
);
```

---

### Feature Removal Backend and Client
**Trigger:** When fully removing a deprecated feature from both backend and frontend.  
**Command:** `/remove-feature`

1. Delete or update backend route files in `site/server/src/routes/`
2. Remove route mounts in `site/server/src/app.js`
3. Delete or update backend test files in `site/server/test/`
4. Delete or update frontend page/component files in `site/client/src/pages/` or `site/client/src/components/`
5. Remove related imports and routing in `site/client/src/App.jsx`

**Example:**
```js
// Remove from site/server/src/app.js
// app.use('/api/groups', groupsRoute);

// Remove from site/client/src/App.jsx
// <Route path="/groups" element={<GroupsPage />} />
```

---

### Refactor Feature Across Multiple Routes and Tests
**Trigger:** When changing a core data model or access logic affecting multiple endpoints.  
**Command:** `/refactor-model`

1. Update multiple route handler files in `site/server/src/routes/` to use the new model or pattern
2. Update corresponding test files in `site/server/test/`
3. Update shared logic or middleware if necessary (e.g., `site/server/src/auth/middleware.js`)

**Example:**
```js
// site/server/src/routes/profile.js
// Replace group-based access with friendship-based access
```

---

### Client Page Addition or Removal with Tests
**Trigger:** When adding or removing a client-side page/component.  
**Command:** `/new-client-page`

1. Create or delete page/component file in `site/client/src/pages/` or `site/client/src/components/`
2. Update routing in `site/client/src/App.jsx`
3. Create or delete corresponding test file in `site/client/src/test/`

**Example:**
```jsx
// site/client/src/pages/Friends.jsx
export function Friends() { return <div>Friends Page</div>; }
```
```jsx
// site/client/src/App.jsx
import { Friends } from './pages/Friends.jsx';
<Route path="/friends" element={<Friends />} />
```

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test File Pattern:** Files end with `.test.js` (backend) or `.test.jsx` (frontend)
- **Location:**  
  - Backend tests: `site/server/test/`  
  - Frontend tests: `site/client/src/test/`
- **Example:**
  ```js
  // site/server/test/user.test.js
  import { getUser } from '../src/user.js';
  import { describe, it, expect } from 'vitest';

  describe('getUser', () => {
    it('returns user by id', () => {
      expect(getUser(1)).toEqual({ id: 1, name: 'Alice' });
    });
  });
  ```

## Commands

| Command            | Purpose                                                      |
|--------------------|--------------------------------------------------------------|
| /new-backend-module| Start a new backend module with corresponding tests           |
| /new-api-route     | Add or refactor an API route and its tests                   |
| /new-migration     | Create or update a database migration                        |
| /remove-feature    | Remove a deprecated feature from backend and frontend         |
| /refactor-model    | Refactor a core model or access pattern across the codebase  |
| /new-client-page   | Add or remove a client page/component with routing and tests  |
```
