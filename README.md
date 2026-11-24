# root/archive Lite

A student-built academic resource-sharing application developed for our undergraduate Cloud Computing course. It is a simplified, independent version of root/archive, designed to demonstrate how cloud services work together in a real application.

**Live application:** https://archive-lite.rootamman.com

The application is deployed. Team members do not need to create Cloudflare resources, configure Google OAuth, or deploy anything to use it.

## 1. Using the application

Anyone can browse the 127-course catalog, search for courses, filter by major (Computer Science, Artificial Intelligence or Cybersecurity), and open shared PDFs without an account.

Students sign in with their university Google account (`@std.aum.edu.jo`) to contribute resources. Open a course and upload a PDF with a title, category and optional semester and contributor name. The upload limit is 10 MiB.

A signed-in contributor can edit their own resource's title, category and semester, or delete it. Administrators can edit and delete other contributors' resources. Uploading still requires an eligible student account.

Use synthetic PDFs for the course demonstration. Do not upload confidential material or real student records; published resources are publicly accessible.

## 2. Cloud architecture

```text
                      Google Identity Services
                              │
                         Google ID token
                              │
Browser ─── Cloudflare Pages ─┘
   │         HTML, CSS, JS, course catalog
   │
   ├── api-lite.rootamman.com ─────┐
   │                               ▼
   └── assets-lite.rootamman.com → Cloudflare Worker
                                   ├── D1: metadata
                                   └── R2: PDF files
```

| Service | Role in our application | Deployed resource |
|---|---|---|
| Cloudflare Pages | Static frontend hosting and delivery | `root-archive-lite` |
| Cloudflare Workers | Serverless API, authentication and file delivery | `root-archive-lite` |
| Cloudflare D1 | Managed SQL database for resource metadata | `root-archive-lite-db` |
| Cloudflare R2 | Private object storage for PDFs | `root-archive-lite-files` |
| Google Identity Services | User authentication through existing university accounts | Dedicated Lite OAuth client |

The frontend runs in the browser, while the Worker runs on Cloudflare's infrastructure. We do not manage a virtual machine, operating system or persistent backend server.

D1 and R2 serve different purposes: SQL is suitable for structured metadata and queries, while object storage is suitable for files. Both are accessed through Worker bindings rather than database passwords or public bucket URLs.

### Live endpoints

- Frontend: https://archive-lite.rootamman.com
- API listing: https://api-lite.rootamman.com/resources
- PDF delivery: `https://assets-lite.rootamman.com/files/<file-key>`

Both the API and asset domains use the **same Worker**. The asset hostname does not expose CRUD endpoints. R2 itself remains private. All three custom domains use HTTPS and the Lite infrastructure is separate from the original root/archive.

## 3. Understanding the code

| File | What to read it for |
|---|---|
| `frontend/index.html` | Page structure and interface |
| `frontend/styles.css` | Visual design and responsive layout |
| `frontend/courses.json` | Static catalog of 127 courses |
| `frontend/js/config.mjs` | Shared resource categories, API URL and public Google client ID |
| `frontend/js/catalog.mjs`, `app.mjs` | Catalog, search, filtering and resource display |
| `frontend/js/contribution.mjs` | Sign-in and resource upload, edit and delete interactions |
| `frontend/js/dom.mjs` | DOM helpers |
| `backend/worker.js` | Complete backend: 204 lines of plain JavaScript, including comments and blank lines |
| `backend/schema.sql` | Database table definition |
| `backend/wrangler.toml` | Worker settings, domains and D1/R2 bindings |
| `backend/package.json` | Dependencies: `jose` and Wrangler |
| `backend/smoke-test.mjs` | Live HTTP integration tests |

Start with `backend/worker.js` and `backend/schema.sql` to understand the cloud implementation. The frontend is static and has no build step. The Worker imports the same catalog and resource categories used by the frontend.

### Database

The single `resources` table contains eight fields:

| Field | Purpose |
|---|---|
| `id` | Unique integer resource ID |
| `course_id` | Reference to a course in the static catalog |
| `title` | Resource title |
| `type` | Resource category |
| `semester` | Optional semester/year |
| `contributor` | Optional public display name |
| `owner_id` | Private, verified Google account identifier (`sub`) |
| `file_key` | Unique key identifying the PDF in R2 |

The course catalog is a static JSON file, not a database table. PDF contents are not stored in D1.

## 4. CRUD operations

| Operation | HTTP endpoint | What happens |
|---|---|---|
| Create | `POST /upload` | Validate the student and PDF, store the file in R2 and insert metadata into D1 |
| Read | `GET /resources` | Retrieve public resource metadata from D1 |
| Read PDF | `GET /files/:key` | Check the D1 reference, retrieve the R2 object and return the PDF |
| Update | `PATCH /resources/:id` | Verify ownership or admin rights and update metadata in D1 |
| Delete | `DELETE /resources/:id` | Verify ownership or admin rights, delete the R2 object, then delete its D1 row |

The upload handler attempts to remove the new PDF if inserting metadata fails. Updates do not replace the file or change ownership. D1 and R2 are separate services, so deletion across both is not a single atomic transaction; a partial failure may require a retry.

## 5. Authentication and authorization

Google handles sign-in and issues an ID token. The browser sends that token as an HTTP Bearer credential for protected requests.

The Worker uses `jose` to verify the token's signature against Google's public keys, issuer, audience and expiration. Student eligibility requires a verified email in `std.aum.edu.jo` and the corresponding Google Workspace hosted-domain claim. The Google `sub` claim identifies the owner, independently of their public display name.

The Worker enforces permissions on every write request. Hiding edit/delete buttons in the interface is not itself a security control. The administrator list is stored as a private Worker secret, not in GitHub. SQL queries use parameter binding.

## 6. Classroom demonstration

Use the live website rather than creating another deployment.

1. Open the website while signed out and demonstrate course search and filtering.
2. Sign in with your university Google account.
3. Choose a course and upload a small, non-confidential sample PDF.
4. Open the uploaded resource and point out its asset delivery hostname.
5. Edit the resource title or category, showing that the PDF remains unchanged.
6. If a second student is available, demonstrate that they cannot edit or delete the first student's resource.
7. Delete the test resource and confirm that it disappears.

A team member with authorized Cloudflare dashboard access can additionally show the Pages deployment, Worker domains and bindings, D1 metadata row, and R2 object before and after deletion.

### Questions to prepare for

| Question | Answer |
|---|---|
| Why use a Worker instead of a traditional server? | It executes API requests on managed cloud infrastructure without managing a server. |
| Why use both D1 and R2? | Metadata needs structured SQL queries; PDFs belong in object storage. |
| Why is the bucket private if PDFs are public? | The Worker controls delivery and checks that a corresponding resource record exists. |
| Who can modify a resource? | Its verified owner or a configured administrator. |
| What happens when a resource is deleted? | Its PDF is removed from R2 and its metadata row from D1. |
| What happens if the database insertion fails? | The upload handler attempts to remove the newly stored PDF. |
| How does the website scale? | Pages and Workers use managed infrastructure, subject to the limits of each cloud service. |
| What makes this different from the original archive? | Lite deliberately omits moderation, revision history, automated cleanup and other production features. |

## 7. Team workflow

The GitHub repository is the source of truth. Team members can clone it or pull the latest version:

```bash
git clone https://github.com/omatek/root-archive-lite.git
# If you already have a clone:
git pull origin main
```

Pages and the Worker are already connected to GitHub. Relevant changes merged into `main` trigger automatic deployments, so coordinate changes with the team before pushing to that branch. Use a separate branch for experiments. Never commit credentials or modify the original archive's infrastructure.

For code changes, the following files are the usual starting points:

| Change | Location |
|---|---|
| Appearance | `frontend/styles.css` |
| Course catalog | `frontend/courses.json` |
| Resource categories | `frontend/js/config.mjs` |
| Upload limit | `frontend/js/config.mjs` and `backend/wrangler.toml` |
| API behavior | `backend/worker.js` |

Changes to the shared catalog and categories require both frontend and Worker deployment. Automated smoke tests run after Worker deployments and can also be run manually from `backend/` using `node smoke-test.mjs` (Node.js 22+).

## 8. Validation and scope

The deployed infrastructure and public functionality were verified on 24 November 2026: HTTPS, the 127-course catalog, public resource listing, exact-origin CORS, rejection of unauthenticated writes and invalid tokens, and rejection of CRUD requests on the asset hostname. A synthetic PDF was temporarily inserted directly into R2 and D1, served successfully through the Worker, and removed from both services.

Real Google sign-in, authenticated CRUD, ownership/admin enforcement with real accounts and interactive browser behavior still require team testing. The demonstration above is the acceptance checklist, not a claim that those tests have already passed.

Lite is an academic demonstration, not a production-grade platform. There is no moderation, malware scanning, rate limiting, bot protection or automated cleanup. The PDF signature check is not malware detection. Public reads are intentional; remove demonstration content after assessment.

The deployment is isolated from root/archive production and staging infrastructure.
