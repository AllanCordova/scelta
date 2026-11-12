const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="brand">Scelta</p>
        <h1>Votação com ordem e clareza</h1>
        <p className="lede">
          Salas digitais para assembleias da igreja — quórum, voto anônimo e
          apuração automática.
        </p>
        <p className="meta">API: {apiUrl}</p>
      </section>
    </main>
  );
}
