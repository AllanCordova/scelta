export function AdminHub() {
  return (
    <div className="admin-page">
      <header className="page-intro">
        <h1>Administração</h1>
        <p className="lede">
          Central administrativa para controle de códigos de acesso e rol de membros da plataforma.
        </p>
      </header>

      <section className="admin-hub-grid" aria-label="Atalhos administrativos">
        <a className="panel admin-hub-card" href="/admin/codigos">
          <h2>Códigos de Acesso</h2>
          <p className="muted">
            Gerar códigos do rol, acompanhar PINs ativos e revogar acessos por sala.
          </p>
          <span className="admin-hub-cta">Gerenciar códigos →</span>
        </a>

        <a className="panel admin-hub-card" href="/admin/membros">
          <h2>Membros da Plataforma</h2>
          <p className="muted">
            Visualizar, buscar, cadastrar manualmente, remover e importar membros via CSV.
          </p>
          <span className="admin-hub-cta">Gerenciar membros →</span>
        </a>

        <a className="panel admin-hub-card" href="/admin/logs">
          <h2>Logs de Auditoria e Integridade</h2>
          <p className="muted">
            Histórico inapagável comprovando que somente pessoas votaram, sem intervenção do admin,
            com exportação para PDF.
          </p>
          <span className="admin-hub-cta">Ver logs e exportar PDF →</span>
        </a>
      </section>
    </div>
  );
}
