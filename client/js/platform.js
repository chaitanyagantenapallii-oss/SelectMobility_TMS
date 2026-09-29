"use strict";
(async () => {
  const $ = (s) => document.querySelector(s);
  function esc(v) {
    return String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function go() {
    if (!Api.token) return location.replace("/SaaS/login.html");
    Api.get("/auth/me")
      .then(({ user }) => {
        if (user.accountType === "tenant-admin")
          return location.replace("/smipl/dashboard.html");
        if (user.role !== "admin")
          return location.replace(
            user.role === "client"
              ? "/client.html"
              : user.role === "driver"
                ? "/driver.html"
                : "/dashboard.html",
          );
        $("#operator").textContent = user.name || "Platform administrator";
        load();
      })
      .catch(() => location.replace("/SaaS/login.html"));
  }
  async function load() {
    try {
      const [o, u] = await Promise.all([
        Api.get("/organisations"),
        Api.get("/users"),
      ]);
      const orgs = o.data || [];
      const users = u.data || [];
      const smiplName = "Select Mobility India Private Limited";
      const managedClients = orgs.filter((x) => x.name !== smiplName);
      $("#stats").innerHTML =
        `<div><small>PeoplePilot tenants</small><b>1</b></div><div><small>SMIPL client portfolio</small><b>${managedClients.length}</b></div><div><small>Client users</small><b>${users.filter((x) => x.role === "client").length}</b></div><div><small>Platform status</small><b class="ok">Live</b></div>`;
      $("#orgs").innerHTML =
        `<article class="provider-org"><div class="org-main"><span class="avatar">PP</span><div><h3>PeoplePilot platform</h3><p>SaaS provider · 1 managed tenant</p></div></div><div class="org-meta"><span class="pill active">PROVIDER</span><span>Platform administration</span></div></article>
         <div class="hierarchy-line">↓ Managed tenant</div>
         <article class="provider-org"><div class="org-main"><span class="avatar">SM</span><div><h3>${esc(smiplName)}</h3><p>SMIPL · Transport management operator</p><span class="tenant-url">https://select-mobility-tms.onrender.com/smipl/login.html</span></div></div><div class="org-meta"><span class="pill active">ACTIVE</span><span>${users.filter((x) => x.organisation === smiplName).length} users</span><a href="/smipl/login.html" target="_blank" rel="noopener">Open SMIPL workspace →</a></div></article>
         <div class="hierarchy-line child">↓ SMIPL client portfolio</div>
         ${managedClients.length ? managedClients.map((x) => `<article class="child-org"><div class="org-main">${x.logoUrl ? `<img class="org-brand" src="${esc(x.logoUrl)}" alt="">` : `<span class="avatar">${esc((x.code || x.name || "T").slice(0, 2).toUpperCase())}</span>`}<div><h3>${esc(x.name)}</h3><p>${esc(x.industry || "Corporate transport")} · ${esc(x.city || "India")}</p></div></div><div class="org-meta"><span class="pill ${x.status === "active" ? "active" : ""}">${esc(x.status || "active")}</span><span>${Number(x.userCount || 0)} users</span></div></article>`).join("") : '<div class="loading">No SMIPL client workspaces yet.</div>'}`;
    } catch (e) {
      $("#orgs").innerHTML =
        `<div class="loading error">${esc(e.message)}</div>`;
    }
  }
  $("#refresh").onclick = load;
  function showView(view) {
    document.querySelectorAll('.platform-view, .platform-module').forEach((panel) => {
      panel.hidden = !(panel.dataset.view === view || panel.id === view);
    });
  }
  showView('overview');
  document.querySelectorAll('.side-link').forEach((link) => {
    link.onclick = () => {
      document.querySelectorAll('.side-link').forEach((item) => item.classList.remove('active'));
      link.classList.add('active');
      const section = link.dataset.section;
      showView(section);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
  const createForm = $("#create-tenant");
  const createButton = document.createElement("button");
  createButton.className = "button";
  createButton.type = "button";
  createButton.textContent = "＋ Create client workspace";
  $(".panel-head").appendChild(createButton);
  createButton.onclick = () => {
    createForm.hidden = !createForm.hidden;
    if (!createForm.hidden) $("#tenant-name").focus();
  };
  $("#cancel-tenant").onclick = () => { createForm.hidden = true; createForm.reset(); };
  createForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(createForm).entries());
      const org = await Api.post("/organisations", { name: values.name, code: values.code, slug: values.slug, city: values.city, contactEmail: values.contactEmail, logoUrl: values.logoUrl, status: values.status, parentOrganisation: "Select Mobility India Private Limited" });
      await Api.post("/users", { name: values.userName, email: values.userEmail, password: values.userPassword, role: "client", organisation: org.data.name });
      createForm.reset();
      createForm.hidden = true;
      await load();
    } catch (error) {
      alert(error.message || "Unable to create the client workspace.");
    }
  };
  $("#logout").onclick = async () => {
    try {
      await Api.post("/auth/logout");
    } catch {}
    Api.clearToken();
    location.replace("/SaaS/login.html");
  };
  go();
})();
