import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthRequestError, updateAdminProfile } from "../auth/auth-api";
import { useAuth, useAuthActions } from "../auth/AuthProvider";
import { ImageDropzone } from "../shell/ImageDropzone";

export function AdminProfile() {
  const auth = useAuth();
  const { updateSessionUser } = useAuthActions();

  const initialName = auth.status === "authenticated" ? auth.user.name : "";
  const initialPhoto = auth.status === "authenticated" ? (auth.user.photoUrl ?? null) : null;

  const [name, setName] = useState(initialName);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhoto);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  if (auth.status !== "authenticated") {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSavedNotice(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Informe um nome com ao menos 2 caracteres.");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateAdminProfile({
        name: trimmedName,
        photoUrl,
      });
      updateSessionUser(updated);
      setName(updated.name);
      setPhotoUrl(updated.photoUrl ?? null);
      setPhotoName(null);
      setSavedNotice("Perfil atualizado com sucesso.");
      toast.success("Perfil atualizado com sucesso.");
    } catch (caught) {
      if (caught instanceof AuthRequestError && caught.errorCode === "invalid_photo_url") {
        setError("A foto enviada é inválida ou excede o limite de 8 MB.");
      } else {
        setError("Não foi possível salvar as alterações do perfil.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <a className="detail-back-link" href="/admin">
        ← Voltar para Administração
      </a>
      <header className="page-intro">
        <h1>Perfil do administrador</h1>
        <p className="lede">
          Atualize seu nome de exibição e sua foto de perfil visível na barra superior.
        </p>
      </header>

      <section className="panel" aria-labelledby="admin-profile-heading">
        <h2 id="admin-profile-heading">Dados da conta</h2>
        <form className="admin-profile-form" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label htmlFor="admin-profile-name">Nome de exibição</label>
            <input
              id="admin-profile-name"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSavedNotice(null);
              }}
              placeholder="Ex.: Conselho Administrativo"
            />
          </div>

          <div>
            <label htmlFor="admin-profile-email">E-mail</label>
            <input id="admin-profile-email" type="email" value={auth.user.email} disabled />
          </div>

          <ImageDropzone
            id="admin-profile-photo"
            label="Foto de perfil"
            value={photoUrl}
            fileName={photoName}
            fallbackName={name || auth.user.name}
            onChange={(nextUrl, nextFileName) => {
              setPhotoUrl(nextUrl);
              setPhotoName(nextFileName);
              setSavedNotice(null);
            }}
            onError={setError}
          />

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {savedNotice ? (
            <p className="form-success" role="status">
              {savedNotice}
            </p>
          ) : null}

          <button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar perfil"}
          </button>
        </form>
      </section>
    </div>
  );
}
