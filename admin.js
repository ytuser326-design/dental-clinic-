module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard | PearlSmile Dental</title>
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --bg: #FFF9F0; --primary: #A8E6CF; --secondary: #A8D8F0;
            --accent: #D9C9FF; --coral: #FFB4A2; --text: #263238; --white: #FFFFFF;
            --clay-shadow: 8px 8px 16px #d1d9e6, -8px -8px 16px #ffffff, inset 2px 2px 4px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.04);
            --clay-hover: 10px 10px 20px #c5cddb, -10px -10px 20px #ffffff, inset 2px 2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(0,0,0,0.05);
            --clay-inset: inset 6px 6px 12px #d1d9e6, inset -6px -6px 12px #ffffff;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Nunito', sans-serif; }
        body { background-color: var(--bg); color: var(--text); padding-bottom: 3rem; }
        h1, h2, h3, h4 { font-family: 'Poppins', sans-serif; }
        
        .hidden { display: none !important; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        
        .clay-card { background: var(--white); border-radius: 24px; box-shadow: var(--clay-shadow); padding: 2rem; margin-bottom: 2rem; transition: all 0.3s ease; }
        .clay-btn { background: var(--primary); border: none; border-radius: 16px; padding: 0.75rem 1.5rem; font-weight: 700; color: var(--text); cursor: pointer; box-shadow: var(--clay-shadow); transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 0.5rem; font-family: 'Poppins', sans-serif; }
        .clay-btn:hover { transform: translateY(-3px); box-shadow: var(--clay-hover); }
        .clay-btn:active { transform: translateY(0); box-shadow: var(--clay-inset); }
        .clay-btn.secondary { background: var(--secondary); }
        .clay-btn.danger { background: var(--coral); }
        
        .clay-input { width: 100%; border: none; background: var(--bg); border-radius: 16px; padding: 1rem; box-shadow: var(--clay-inset); outline: none; font-size: 1rem; margin-bottom: 1.5rem; color: var(--text); }
        
        /* Login Screen */
        #login-screen { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .login-box { max-width: 400px; width: 100%; text-align: center; }
        
        /* Dashboard Layout */
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3rem; }
        .nav-tabs { display: flex; gap: 1rem; margin-bottom: 2rem; overflow-x: auto; padding-bottom: 1rem; }
        
        /* Stats Grid */
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
        .stat-card { text-align: center; }
        .stat-card h3 { font-size: 2.5rem; color: var(--primary); margin-bottom: 0.5rem; }
        
        /* Tables */
        .table-responsive { overflow-x: auto; border-radius: 16px; box-shadow: var(--clay-inset); padding: 1rem; background: var(--white); }
        table { width: 100%; border-collapse: collapse; min-width: 700px; }
        th, td { padding: 1rem; text-align: left; border-bottom: 2px solid var(--bg); }
        th { font-weight: 700; color: #666; font-family: 'Poppins', sans-serif; }
        tr:last-child td { border-bottom: none; }
        
        .badge { padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; }
        .badge.pending { background: #ffeaa7; color: #d68910; }
        .badge.confirmed { background: var(--primary); color: #1e8449; }
        .badge.completed { background: var(--secondary); color: #21618c; }
        .badge.cancelled { background: var(--coral); color: #a93226; }
        
        .action-btns { display: flex; gap: 0.5rem; }
        .action-btns button { padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 12px; }
        
        #toast { position: fixed; bottom: 2rem; right: 2rem; background: var(--text); color: var(--white); padding: 1rem 2rem; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); transform: translateY(150%); transition: transform 0.3s ease; z-index: 1000; }
        #toast.show { transform: translateY(0); }
    </style>
</head>
<body>

<div id="login-screen">
    <div class="clay-card login-box">
        <div style="color: var(--primary); margin-bottom: 1rem;"><i data-lucide="shield" style="width: 48px; height: 48px;"></i></div>
        <h2 style="margin-bottom: 2rem;">Admin Access</h2>
        <form id="login-form">
            <input type="email" id="login-email" class="clay-input" placeholder="Admin Email" required>
            <input type="password" id="login-password" class="clay-input" placeholder="Password" required>
            <button type="submit" class="clay-btn" style="width: 100%; justify-content: center;">Secure Login</button>
        </form>
    </div>
</div>

<div id="dashboard-screen" class="hidden container">
    <header class="clay-card" style="padding: 1.5rem 2rem; margin-bottom: 2rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="background: var(--primary); padding: 0.5rem; border-radius: 12px;"><i data-lucide="tooth" color="#fff"></i></div>
            <h2>PearlSmile Admin</h2>
        </div>
        <button class="clay-btn danger" onclick="logout()"><i data-lucide="log-out"></i> Logout</button>
    </header>

    <div class="nav-tabs">
        <button class="clay-btn" onclick="showTab('tab-appointments')">Appointments</button>
        <button class="clay-btn secondary" onclick="showTab('tab-messages')">Contact Messages</button>
    </div>

    <!-- Appointments Tab -->
    <div id="tab-appointments" class="tab-content">
        <div class="stats-grid" id="stats-container">
            <div class="clay-card stat-card"><h3 id="stat-total">-</h3><p>Total Bookings</p></div>
            <div class="clay-card stat-card"><h3 id="stat-pending">-</h3><p>Pending</p></div>
            <div class="clay-card stat-card"><h3 id="stat-today">-</h3><p>Today</p></div>
        </div>

        <div class="clay-card">
            <h3 style="margin-bottom: 1.5rem;">Recent Appointments</h3>
            <div class="table-responsive">
                <table>
                    <thead><tr><th>Ref</th><th>Patient</th><th>Date & Time</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody id="appointments-tbody"><tr><td colspan="5">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Messages Tab -->
    <div id="tab-messages" class="tab-content hidden">
        <div class="clay-card">
            <h3 style="margin-bottom: 1.5rem;">Patient Inquiries</h3>
            <div class="table-responsive">
                <table>
                    <thead><tr><th>Date</th><th>Name</th><th>Subject</th><th>Message</th><th>Contact</th></tr></thead>
                    <tbody id="messages-tbody"><tr><td colspan="5">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>
</div>

<div id="toast">Message</div>

<script>
    lucide.createIcons();

    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function showTab(id) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
        if (id === 'tab-appointments') loadDashboard();
        if (id === 'tab-messages') loadMessages();
    }

    async function apiCall(endpoint, method = 'GET', body = null) {
        const options = { method, headers: {} };
        if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
        const res = await fetch(endpoint, options);
        if (res.status === 401) {
            document.getElementById('dashboard-screen').classList.add('hidden');
            document.getElementById('login-screen').classList.remove('hidden');
            throw new Error('Unauthorized');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await apiCall('/api/admin/login', 'POST', { email, password });
            showToast('Login successful');
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            loadDashboard();
        } catch (err) {
            showToast(err.message);
        }
    });

    async function logout() {
        try {
            await apiCall('/api/admin/logout', 'POST');
            location.reload();
        } catch (err) { showToast(err.message); }
    }

    async function loadDashboard() {
        try {
            const data = await apiCall('/api/admin/dashboard');
            document.getElementById('stat-total').textContent = data.stats.total;
            document.getElementById('stat-pending').textContent = data.stats.pending;
            document.getElementById('stat-today').textContent = data.stats.today;

            const tbody = document.getElementById('appointments-tbody');
            tbody.innerHTML = '';
            if (data.appointments.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5">No appointments found.</td></tr>';
                return;
            }
            data.appointments.forEach(app => {
                const tr = document.createElement('tr');
                let actions = '';
                if (app.status === 'pending') {
                    actions += '<button class="clay-btn secondary" onclick="updateApp(\\'' + app._id + '\\', \\'confirmed\\')">Confirm</button> ';
                    actions += '<button class="clay-btn danger" onclick="updateApp(\\'' + app._id + '\\', \\'cancelled\\')">Cancel</button>';
                } else if (app.status === 'confirmed') {
                    actions += '<button class="clay-btn" onclick="updateApp(\\'' + app._id + '\\', \\'completed\\')">Complete</button> ';
                    actions += '<button class="clay-btn danger" onclick="updateApp(\\'' + app._id + '\\', \\'cancelled\\')">Cancel</button>';
                }
                tr.innerHTML = 
                    '<td>' + app.reference + '</td>' +
                    '<td><strong>' + app.patientName + '</strong><br><small>' + app.phone + '</small></td>' +
                    '<td>' + app.date + '<br><small>' + app.time + '</small></td>' +
                    '<td><span class="badge ' + app.status + '">' + app.status + '</span></td>' +
                    '<td class="action-btns">' + actions + '</td>';
                tbody.appendChild(tr);
            });
        } catch (err) { console.error(err); }
    }

    async function updateApp(id, status) {
        if (!confirm('Mark appointment as ' + status + '?')) return;
        try {
            await apiCall('/api/admin/appointments/' + id, 'PATCH', { status });
            showToast('Updated successfully');
            loadDashboard();
        } catch (err) { showToast(err.message); }
    }

    async function loadMessages() {
        try {
            const data = await apiCall('/api/admin/messages');
            const tbody = document.getElementById('messages-tbody');
            tbody.innerHTML = '';
            if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="5">No messages.</td></tr>'; return; }
            data.forEach(msg => {
                const tr = document.createElement('tr');
                tr.innerHTML = 
                    '<td>' + new Date(msg.createdAt).toLocaleDateString() + '</td>' +
                    '<td>' + msg.name + '</td>' +
                    '<td>' + msg.subject + '</td>' +
                    '<td>' + msg.message + '</td>' +
                    '<td>' + msg.email + '<br>' + msg.phone + '</td>';
                tbody.appendChild(tr);
            });
        } catch(err) {}
    }

    // Auto-check auth on load
    window.addEventListener('DOMContentLoaded', async () => {
        try {
            await apiCall('/api/admin/me');
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            loadDashboard();
        } catch (err) {
            // Already showing login
        }
    });
</script>
</body>
</html>`;
