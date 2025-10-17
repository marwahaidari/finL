# Government Portal

**Fullstack Web Application** for managing citizen requests, orders, notifications, and administrative tasks.

---

## Author
**Marwa Haidari**

---

## Technologies
- Node.js
- Express.js
- EJS (Embedded JavaScript templates)
- express-session
- express-validator
- multer (file uploads)
- json2csv (CSV exports)
- Other utility modules for Backup, AI, Audit

---

## Project Structure

routes/
├─ index.js # Main routes, dashboard, profile, notifications, reviews, admin panels
├─ auth.js # Authentication: login, register, 2FA, profile
├─ admin.js # Admin panel: user/service management, requests, notifications, payments, reports, backup
├─ dashboard.js # Dashboard routes for officers and admin



---

## Endpoints

### 1. `index.js` (Main Routes)

#### Home & Dashboard
- `GET /` : Home page
- `GET /dashboard` : Admin dashboard
- `GET /officer` : Officer dashboard
- `POST /officer/orders/:id/approve` : Approve order
- `POST /officer/orders/:id/reject` : Reject order

#### Profile
- `GET /profile` : View profile
- `POST /profile/edit` : Edit profile
- `POST /profile/change-password` : Change password
- `GET /logout` : Logout

#### Orders (minimal routes, detailed in `orderRoutes.js`)
- `GET /orders/:orderId/messages`
- `POST /orders/:orderId/messages`
- `GET /orders/:orderId/files`
- `GET /orders/:orderId/files/:fileId/download`
- `POST /orders/:orderId/files/:fileId/delete`

#### Notifications
- `GET /notifications`
- `POST /notifications/:id/read`
- `POST /notifications/:id/delete`
- `POST /notifications/clear`

#### Reviews
- `GET /reviews`
- `POST /reviews/delete/:id`

#### Admin & Management (simplified)
- `GET /admin`
- `GET /admin/users`
- `GET /admin/services`
- `GET /admin/departments`
- `GET /admin/payments`
- `GET /admin/settings`
- `GET /admin/backup`
- `POST /admin/ai/analyze`
- `POST /admin/ai/chat`
- `GET /admin/export/:type`

---

### 2. `auth.js` (Authentication)
- `GET /register` : Registration page
- `POST /register` : Register user
- `GET /verify/:token` : Email verification
- `GET /login` : Login page
- `POST /login` : Login
- `GET /2fa/setup` : Enable 2FA
- `POST /2fa/verify` : Verify 2FA
- `GET /logout` : Logout
- `GET /profile` : Profile page
- `POST /profile` : Update profile
- `POST /profile/change-password` : Change password

---

### 3. `admin.js` (Admin Panel)
- **User Management**:
  - `GET /users`
  - `GET /users/:id`
  - `POST /users/create`
  - `POST /users/update/:id`
  - `POST /users/deactivate/:id`
  - `POST /users/activate/:id`
  - `POST /users/reset-password/:id`
  - `POST /users/suspend/:id`
  - `POST /users/role/:id`
  - `POST /users/toggle-2fa/:id`
  - `POST /users/bulk`
  - `GET /users/export`
  - `POST /users/impersonate/:id`
  - `POST /users/stop-impersonate`

- **Requests / Applications**:
  - `GET /requests`
  - `GET /requests/:id`
  - `POST /requests/create`
  - `POST /requests/update/:id`
  - `POST /requests/delete/:id`
  - `GET /requests/export`

- **Reviews / Feedback**:
  - `GET /reviews`
  - `POST /reviews/delete/:id`

- **Notifications**:
  - `GET /notifications`
  - `POST /notifications/create`
  - `POST /notifications/broadcast`
  - `POST /notifications/delete/:id`
  - `POST /notifications/clear`

- **Payments**:
  - `GET /payments`
  - `POST /payments/refund/:id`

- **Files**:
  - `GET /files`
  - `POST /files/delete/:id`

- **Reports & Analytics**:
  - `GET /reports`
  - `POST /reports/generate`
  - `GET /reports/export`

- **Settings**:
  - `GET /settings`
  - `POST /settings/update`

- **Backup**:
  - `GET /backup`
  - `POST /backup/create`
  - `POST /backup/restore/:id`

- **AI**:
  - `POST /ai/analyze`
  - `POST /ai/chat`

---

### 4. `dashboard.js`
- `GET /dashboard` : General dashboard
- `GET /dashboard/officer` : Officer-specific dashboard
- `GET /dashboard/admin` : Admin-specific dashboard

---

Assignments

GET /assignments : List all requests (admin/officer)

POST /assignments/create : Create new request (citizen)

GET /assignments/:id : Get request by ID

POST /assignments/status/:id : Update request status (admin/officer)

GET /assignments/citizen/:userId : Get requests for a specific citizen

POST /assignments/delete/:id : Delete request

Departments

GET /departments : List all departments (admin, with pagination)

POST /departments : Create new department (admin)

PUT /departments/:id : Update department (admin)

DELETE /departments/:id : Delete department (admin)

PATCH /departments/:id/toggle : Toggle active/inactive (admin)

GET /departments/search : Search/filter departments (admin)

GET /departments/:id : Get department details (admin/officer)

Notifications

POST /notifications : Create notification

POST /notifications/bulk : Create bulk notifications

GET /notifications : List all notifications

GET /notifications/user/:userId : Get notifications for a specific user

GET /notifications/:id : Get notification by ID

DELETE /notifications/:id : Delete notification

POST /notifications/:id/read : Mark as read

POST /notifications/read-all : Mark all as read

POST /notifications/:id/delivered : Mark as delivered

POST /notifications/:id/archive : Archive notification

GET /notifications/search : Search notifications

GET /notifications/count/unread : Count unread notifications

GET /notifications/unread : Get unread notifications

POST /notifications/send-realtime : Send realtime notification

Orders

GET /orders : List all orders

GET /orders/create : Form for creating order

POST /orders/create : Create new order

GET /orders/edit/:id : Form to edit order

POST /orders/edit/:id : Save edited order

GET /orders/delete/:id : Confirm delete page

POST /orders/delete/:id : Delete order

POST /orders/pay/:id : Pay order

GET /orders/paid : View paid orders

GET /orders/admin/reports : Admin reports

GET /orders/api : API endpoint for orders

GET /orders/:id : Order details

Files

GET /orders/:orderId/files : List order files

GET /orders/:orderId/files/:fileId/download : Download file

POST /orders/:orderId/files/:fileId/delete : Delete file

Messages

GET /orders/:orderId/messages : List messages

POST /orders/:orderId/messages : Send message

POST /orders/:orderId/messages/:messageId/reply : Reply to message

POST /orders/:orderId/messages/:messageId/delete : Delete message   

Settings / Uploads

POST /settings : Create new setting

GET /settings : List all settings (with filters & pagination)

GET /settings/:id : Get setting by ID

PUT /settings/:id : Update setting

PATCH /settings/:id/soft-delete : Soft delete setting

DELETE /settings/:id : Hard delete setting

PATCH /settings/:id/archive : Archive setting

PATCH /settings/:id/restore : Restore archived setting

GET /settings/count/all : Count all settings

Services

GET /services : List all services (admin)

GET /services/department/:department_id : List services by department

POST /services : Create service (admin)

PUT /services/:id : Update service (admin)

DELETE /services/:id : Delete service (admin)

Requests

GET /requests/create : Request creation page

POST /requests/create : Create new request

GET /requests : List all requests

GET /requests/:id : Request details

POST /requests/:id/upload : Upload document for request

POST /requests/:id/review : Review request (approve/reject)

2FA / Authentication

GET /2fa/setup : Enable 2FA setup page

POST /2fa/verify : Verify 2FA code   


Payments:

GET /payments/dashboard : Payment management page (EJS)

POST /payments/ : Create new payment

GET /payments/user/:userId : Get all payments of a user

GET /payments/user/:userId/count : Count payments of a user

GET /payments/:id/history : Get payment history

GET /payments/:id : Get payment details

PUT /payments/:id/status : Update payment status

PUT /payments/:id/mark-paid : Mark payment as paid

DELETE /payments/:id/soft : Soft delete (disable) payment

DELETE /payments/:id : Hard delete payment 


Backup (backupRoutes.js)

POST /backup/database : Create database backup (admin only)

POST /backup/files : Create files backup (admin only)

POST /backup/restore : Restore database backup (admin only)

GET /backup/history : Get backup history (admin & supervisor)

Files (file.js)

POST /:orderId/upload : Upload file for an order

GET /:orderId/files : List files of an order

GET /download/:id : Download a file by ID

GET /preview/:id : Preview a file

POST /update/:id : Replace a file

POST /archive/:id : Archive a file

POST /delete/:id : Delete a file

Payments (paymentRoutes.js)

GET /dashboard : Payment management page (EJS)

POST / : Create new payment

GET /user/:userId : Get all payments of a user

GET /user/:userId/count : Count payments of a user

GET /:id/history : Get payment history

GET /:id : Get payment details

PUT /:id/status : Update payment status

PUT /:id/mark-paid : Mark payment as paid

DELETE /:id/soft : Soft delete (disable) payment

DELETE /:id : Hard delete payment




## Notes
- All routes are protected by authentication (`ensureAuthenticated`) and role-based access (`checkRole`) where required.
- File uploads handled via `multer`.
- Validation via `express-validator`.
- CSV exports via `json2csv`.

---

## Setup
```bash
git clone <repo-url>
cd government-portal
npm install
npm run dev
