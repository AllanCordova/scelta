import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod } from "../forms/validation";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { DatePickerField } from "../shell/DatePickerField";
import { ImageDropzone } from "../shell/ImageDropzone";
import { memberImportSummaryLabel } from "./copy";
import { createMember, deleteMember, importMembers, listMembersPage, updateMember } from "./rooms-api";
import type { StoredMemberItem } from "./types";

const apiBase = apiUrl("");

const EXPECTED_COLUMNS = [
  "nome",
  "comungante",
  "sexo",
  "data_nascimento",
  "upa_ativo",
  "upa_ingresso",
  "ump_ativo",
  "ump_ingresso",
  "foto",
] as const;

const CSV_TEMPLATE_CONTENT = [
  EXPECTED_COLUMNS.join(","),
  "Allan Silva,sim,M,1985-04-12,nao,,nao,,https://example.com/allan.jpg",
  "Silas Companheiro,sim,M,1998-06-01,sim,2024-01-10,nao,,",
  "Lídia de Tiatira,sim,F,1995-03-20,nao,,sim,2023-05-01,",
].join("\n");

const TEMPLATE_DATA_URL = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE_CONTENT)}`;

export function AdminMembers() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [members, setMembers] = useState<StoredMemberItem[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCommunicant, setManualCommunicant] = useState(true);
  const [manualGender, setManualGender] = useState<"" | "M" | "F">("");
  const [manualBirthDate, setManualBirthDate] = useState("");
  const [manualPhotoUrl, setManualPhotoUrl] = useState<string | null>(null);
  const [manualPhotoName, setManualPhotoName] = useState<string | null>(null);
  const [manualUpaActive, setManualUpaActive] = useState(false);
  const [manualUmpActive, setManualUmpActive] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [pendingDeleteMember, setPendingDeleteMember] = useState<StoredMemberItem | null>(null);
  const [editingMember, setEditingMember] = useState<StoredMemberItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCommunicant, setEditCommunicant] = useState(true);
  const [editGender, setEditGender] = useState<"" | "M" | "F">("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [editPhotoName, setEditPhotoName] = useState<string | null>(null);
  const [editUpaActive, setEditUpaActive] = useState(false);
  const [editUmpActive, setEditUmpActive] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileSizeKb, setSelectedFileSizeKb] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [rejectedRows, setRejectedRows] = useState<{ line: number; name?: string; reason: string }[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!editingMember) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingEdit) {
        setEditingMember(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingMember, isSavingEdit]);

  useEffect(() => {
    let cancelled = false;
    void listMembersPage(apiBase, { search, page, pageSize: 10 })
      .then((result) => {
        if (!cancelled) {
          setMembers(result.members);
          setTotalMembers(result.total);
          setTotalPages(result.totalPages);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMembers([]);
          setTotalMembers(0);
          setTotalPages(1);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadVersion, search, page]);

const csvFileSchema = z.object({
  file: z
    .custom<File>((val) => val instanceof File, "Por favor, envie um arquivo .CSV válido.")
    .refine(
      (file) => file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv",
      "Por favor, envie um arquivo .CSV válido.",
    )
    .refine((file) => file.size > 0, "O arquivo CSV está vazio.")
    .refine(
      (file) => file.size <= 10 * 1024 * 1024,
      "O arquivo CSV excede o limite de 10MB.",
    ),
});

const csvImportSchema = z.object({
  file: z.string().trim().min(1, "Selecione ou solte um arquivo CSV antes de importar."),
});
  async function processSelectedFile(file: File) {
    setImportError(null);
    setImportSummary(null);
    setRejectedRows([]);

    const validation = validateWithZod(csvFileSchema, { file });
    if (!validation.ok) {
      setSelectedFileName(null);
      setSelectedFileSizeKb(null);
      setCsvContent("");
      setImportError(validation.firstError);
      return;
    }

    const text = await readFileAsText(file);
    setSelectedFileName(file.name);
    setSelectedFileSizeKb((file.size / 1024).toFixed(1));
    setCsvContent(text);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  }

  async function handleImport() {
    setImportError(null);
    setImportSummary(null);
    setRejectedRows([]);

    const validation = validateWithZod(csvImportSchema, { file: csvContent });
    if (!validation.ok) {
      setImportError(validation.firstError);
      return;
    }

    setIsImporting(true);
    try {
      const report = await importMembers(apiBase, csvContent);
      const summary = memberImportSummaryLabel(
        report.createdCount,
        report.updatedCount,
        report.rejectedCount,
      );
      setImportSummary(summary);
      setRejectedRows(Array.isArray(report.rejectedRows) ? report.rejectedRows : []);
      if (report.rejectedCount > 0) {
        toast.warning(summary);
      } else {
        toast.success(summary);
      }
      setSelectedFileName(null);
      setSelectedFileSizeKb(null);
      setCsvContent("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setReloadVersion((current) => current + 1);
    } catch {
      setImportError("Não foi possível importar a lista de membros.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleClearPhoto() {
    setManualPhotoUrl(null);
    setManualPhotoName(null);
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualError(null);
    const trimmed = manualName.trim();
    if (trimmed.length < 2) {
      setManualError("Informe o nome completo com ao menos 2 caracteres.");
      return;
    }
    if (manualUpaActive && manualUmpActive) {
      setManualError("Um membro não pode estar ativo na UPA e na UMP ao mesmo tempo.");
      return;
    }

    setIsAddingMember(true);
    try {
      await createMember(apiBase, {
        fullName: trimmed,
        isCommunicant: manualCommunicant,
        isMale: manualGender === "" ? null : manualGender === "M",
        birthDate: manualBirthDate.trim().length > 0 ? manualBirthDate.trim() : null,
        photoUrl: manualPhotoUrl,
        societyFlags: {
          upaActive: manualUpaActive,
          umpActive: manualUmpActive,
        },
      });
      setManualName("");
      setManualCommunicant(true);
      setManualGender("");
      setManualBirthDate("");
      setManualUpaActive(false);
      setManualUmpActive(false);
      handleClearPhoto();
      setPage(1);
      setReloadVersion((current) => current + 1);
      toast.success("Membro cadastrado com sucesso.");
    } catch {
      setManualError("Não foi possível cadastrar o membro.");
      toast.error("Não foi possível cadastrar o membro.");
    } finally {
      setIsAddingMember(false);
    }
  }

  function openEditMember(member: StoredMemberItem) {
    setEditingMember(member);
    setEditName(member.fullName);
    setEditCommunicant(member.isCommunicant);
    setEditGender(member.isMale === true ? "M" : member.isMale === false ? "F" : "");
    setEditBirthDate(member.birthDate ?? "");
    setEditPhotoUrl(member.photoUrl ?? null);
    setEditPhotoName(null);
    setEditUpaActive(Boolean(member.societyFlags.upaActive));
    setEditUmpActive(Boolean(member.societyFlags.umpActive));
    setEditError(null);
  }

  async function handleSaveEditMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMember || isSavingEdit) {
      return;
    }
    setEditError(null);
    const trimmed = editName.trim();
    if (trimmed.length < 2) {
      setEditError("Informe o nome completo com ao menos 2 caracteres.");
      return;
    }
    if (editUpaActive && editUmpActive) {
      setEditError("Um membro não pode estar ativo na UPA e na UMP ao mesmo tempo.");
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateMember(apiBase, editingMember.id, {
        fullName: trimmed,
        isCommunicant: editCommunicant,
        isMale: editGender === "" ? null : editGender === "M",
        birthDate: editBirthDate.trim().length > 0 ? editBirthDate.trim() : null,
        photoUrl: editPhotoUrl,
        societyFlags: {
          upaActive: editUpaActive,
          umpActive: editUmpActive,
        },
      });
      setEditingMember(null);
      setReloadVersion((current) => current + 1);
      toast.success("Membro atualizado com sucesso.");
    } catch {
      setEditError("Não foi possível atualizar o membro.");
      toast.error("Não foi possível atualizar o membro.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDeleteMember(memberId: string) {
    if (deletingMemberId) {
      return;
    }
    setDeletingMemberId(memberId);
    try {
      await deleteMember(apiBase, memberId);
      setPendingDeleteMember(null);
      setReloadVersion((current) => current + 1);
      toast.success("Membro removido do rol.");
    } catch {
      setManualError("Não foi possível remover o membro.");
      toast.error("Não foi possível remover o membro.");
    } finally {
      setDeletingMemberId(null);
    }
  }

  return (
    <div className="admin-page">
      <a className="detail-back-link" href="/admin">
        ← Voltar para Administração
      </a>
      <header className="page-intro">
        <h1>Rol de membros</h1>
        <p className="lede">
          Gerencie os membros da plataforma manualmente ou via importação de planilha CSV.
        </p>
      </header>

      <section className="panel" aria-labelledby="member-manual-heading">
        <h2 id="member-manual-heading">Adicionar membro</h2>
        <form className="member-manual-form" onSubmit={(event) => void handleAddMember(event)}>
          <div className="member-manual-grid">
            <div>
              <label htmlFor="manual-member-name">Nome completo</label>
              <input
                id="manual-member-name"
                type="text"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                placeholder="Ex.: Allan"
              />
            </div>
            <div>
              <label htmlFor="manual-member-gender">Sexo</label>
              <select
                id="manual-member-gender"
                value={manualGender}
                onChange={(event) => setManualGender(event.target.value as "" | "M" | "F")}
              >
                <option value="">Não informado</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
            <div>
              <label htmlFor="manual-member-birth">Data de nascimento</label>
              <DatePickerField
                id="manual-member-birth"
                value={manualBirthDate}
                onChange={setManualBirthDate}
              />
            </div>
          </div>
          <div className="member-society-row">
            <label className="checkbox-row" htmlFor="manual-member-communicant">
              <input
                id="manual-member-communicant"
                type="checkbox"
                checked={manualCommunicant}
                onChange={(event) => setManualCommunicant(event.target.checked)}
              />
              <span>Membro comungante</span>
            </label>
            <label className="checkbox-row" htmlFor="manual-member-upa">
              <input
                id="manual-member-upa"
                type="checkbox"
                checked={manualUpaActive}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setManualUpaActive(checked);
                  if (checked) {
                    setManualUmpActive(false);
                  }
                }}
              />
              <span>Ativo na UPA</span>
            </label>
            <label className="checkbox-row" htmlFor="manual-member-ump">
              <input
                id="manual-member-ump"
                type="checkbox"
                checked={manualUmpActive}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setManualUmpActive(checked);
                  if (checked) {
                    setManualUpaActive(false);
                  }
                }}
              />
              <span>Ativo na UMP</span>
            </label>
          </div>
          <ImageDropzone
            id="manual-member-photo"
            label="Foto do membro (opcional)"
            value={manualPhotoUrl}
            fileName={manualPhotoName}
            fallbackName={manualName || "SC"}
            onChange={(nextUrl, nextFileName) => {
              setManualPhotoUrl(nextUrl);
              setManualPhotoName(nextFileName);
            }}
            onError={setManualError}
          />
          {manualError ? (
            <p className="form-error" role="alert">
              {manualError}
            </p>
          ) : null}
          <button type="submit" disabled={isAddingMember}>
            {isAddingMember ? "Cadastrando…" : "Adicionar membro"}
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="member-list-heading">
        <div className="member-list-header">
          <h2 id="member-list-heading">Membros cadastrados</h2>
          <span className="member-count-pill">Total: {totalMembers}</span>
        </div>
        <div className="member-search-row">
          <label htmlFor="member-search-input" className="sr-only">
            Buscar membro
          </label>
          <input
            id="member-search-input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar membro por nome…"
          />
        </div>
        {members.length === 0 ? (
          <p className="muted">Nenhum membro encontrado.</p>
        ) : (
          <ul className="member-directory-list" aria-label="Lista de membros">
            {members.map((member) => (
              <li key={member.id} className="member-directory-row">
                <div className="member-directory-lead">
                  {member.photoUrl ? (
                    <img src={member.photoUrl} alt="" className="member-avatar-img" />
                  ) : (
                    <span className="member-avatar-placeholder" aria-hidden="true">
                      {initialsFromName(member.fullName)}
                    </span>
                  )}
                  <div className="member-directory-info">
                    <strong>{member.fullName}</strong>
                    <span className="muted">
                      {member.isCommunicant ? "Comungante" : "Não comungante"}
                      {member.isMale === true
                        ? " · Masculino"
                        : member.isMale === false
                          ? " · Feminino"
                          : ""}
                      {member.birthDate ? ` · ${member.birthDate}` : ""}
                      {member.societyFlags.upaActive ? " · UPA" : ""}
                      {member.societyFlags.umpActive ? " · UMP" : ""}
                    </span>
                  </div>
                </div>
                <div className="member-row-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => openEditMember(member)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="ghost danger-text"
                    disabled={deletingMemberId === member.id}
                    onClick={() => setPendingDeleteMember(member)}
                  >
                    {deletingMemberId === member.id ? "Removendo…" : "Remover"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="pagination-bar" aria-label="Paginação de membros">
          <button
            type="button"
            className="ghost"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </button>
          <span className="muted">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            className="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Próxima
          </button>
        </div>
      </section>

      <section className="panel member-import-box" aria-labelledby="member-import-heading">
        <div className="member-import-header">
          <div>
            <h2 id="member-import-heading">Importar planilha CSV</h2>
            <p className="muted">
              Baixe o modelo esperado ou envie um arquivo CSV com o rol atualizado.
            </p>
          </div>
          <div className="member-import-badges">
            <span className="member-count-pill">Membros: {totalMembers} aptos</span>
            <a
              className="template-download-btn"
              href={TEMPLATE_DATA_URL}
              download="modelo-membros-scelta.csv"
            >
              Baixar template CSV
            </a>
          </div>
        </div>

        <div
          className={isDragging ? "upload-zone dragging" : "upload-zone"}
          aria-invalid={Boolean(importError)}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            id="member-csv-file"
            type="file"
            accept=".csv,text/csv"
            aria-label="Arquivo CSV de membros"
            className="sr-only"
            onChange={handleFileChange}
          />
          <div className="upload-icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
            </svg>
          </div>
          <p className="upload-zone-title">
            Arraste e solte o arquivo CSV aqui ou{" "}
            <span className="upload-zone-cta">clique para selecionar</span>
          </p>
          <p className="upload-zone-subtitle">
            Apenas formato <code>.csv</code> (tamanho máximo de até 10MB)
          </p>

          <div className="upload-columns-box">
            <div className="upload-columns-title">Colunas esperadas no cabeçalho</div>
            <div className="upload-columns-list">
              {EXPECTED_COLUMNS.map((column) => (
                <span key={column} className="upload-column-badge">
                  {column}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="upload-action-bar">
          <div className="upload-file-status" aria-live="polite">
            {selectedFileName ? (
              <span>
                <strong>{selectedFileName}</strong> ({selectedFileSizeKb} KB) pronto para importar
              </span>
            ) : (
              <span>Nenhum arquivo novo selecionado</span>
            )}
          </div>
          <button
            type="button"
            className="ghost"
            disabled={isImporting}
            onClick={() => void handleImport()}
          >
            {isImporting ? "Importando..." : "Importar membros"}
          </button>
        </div>

        {importSummary ? (
          <p className="import-summary" aria-live="polite">
            {importSummary}
          </p>
        ) : null}
        {rejectedRows.length > 0 ? (
          <div className="import-rejected-box" role="alert">
            <strong>Linhas rejeitadas na importação:</strong>
            <ul className="import-rejected-list">
              {rejectedRows.map((row, index) => (
                <li key={`${row.line}-${row.reason}-${index}`}>
                  Linha {row.line}
                  {row.name ? ` (${row.name})` : ""}: {importRejectionReasonLabel(row.reason)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {importError ? (
          <p className="form-error" role="alert">
            {importError}
          </p>
        ) : null}
      </section>

      <ConfirmDialog
        open={pendingDeleteMember !== null}
        title="Remover membro"
        description={
          pendingDeleteMember
            ? `Tem certeza que deseja remover "${pendingDeleteMember.fullName}" do rol de membros?`
            : ""
        }
        confirmLabel={deletingMemberId ? "Removendo…" : "Remover"}
        busy={Boolean(deletingMemberId)}
        onCancel={() => setPendingDeleteMember(null)}
        onConfirm={() => {
          if (pendingDeleteMember) {
            void handleDeleteMember(pendingDeleteMember.id);
          }
        }}
      />

      {editingMember ? (
        <div
          className="confirm-dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isSavingEdit) {
              setEditingMember(null);
            }
          }}
        >
          <div
            className="panel member-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-member-dialog-title"
          >
            <h2 id="edit-member-dialog-title">Editar membro</h2>
            <form
              className="member-manual-form"
              onSubmit={(event) => void handleSaveEditMember(event)}
            >
              <div className="member-manual-grid">
                <div>
                  <label htmlFor="edit-member-name">Nome completo</label>
                  <input
                    id="edit-member-name"
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    placeholder="Ex.: Allan"
                  />
                </div>
                <div>
                  <label htmlFor="edit-member-gender">Sexo</label>
                  <select
                    id="edit-member-gender"
                    value={editGender}
                    onChange={(event) => setEditGender(event.target.value as "" | "M" | "F")}
                  >
                    <option value="">Não informado</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-member-birth">Data de nascimento</label>
                  <DatePickerField
                    id="edit-member-birth"
                    value={editBirthDate}
                    onChange={setEditBirthDate}
                  />
                </div>
              </div>
              <div className="member-society-row">
                <label className="checkbox-row" htmlFor="edit-member-communicant">
                  <input
                    id="edit-member-communicant"
                    type="checkbox"
                    checked={editCommunicant}
                    onChange={(event) => setEditCommunicant(event.target.checked)}
                  />
                  <span>Membro comungante</span>
                </label>
                <label className="checkbox-row" htmlFor="edit-member-upa">
                  <input
                    id="edit-member-upa"
                    type="checkbox"
                    checked={editUpaActive}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setEditUpaActive(checked);
                      if (checked) {
                        setEditUmpActive(false);
                      }
                    }}
                  />
                  <span>Ativo na UPA</span>
                </label>
                <label className="checkbox-row" htmlFor="edit-member-ump">
                  <input
                    id="edit-member-ump"
                    type="checkbox"
                    checked={editUmpActive}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setEditUmpActive(checked);
                      if (checked) {
                        setEditUpaActive(false);
                      }
                    }}
                  />
                  <span>Ativo na UMP</span>
                </label>
              </div>
              <ImageDropzone
                id="edit-member-photo"
                label="Foto do membro (opcional)"
                value={editPhotoUrl}
                fileName={editPhotoName}
                fallbackName={editName || "SC"}
                onChange={(nextUrl, nextFileName) => {
                  setEditPhotoUrl(nextUrl);
                  setEditPhotoName(nextFileName);
                }}
                onError={setEditError}
              />
              {editError ? (
                <p className="form-error" role="alert">
                  {editError}
                </p>
              ) : null}
              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={isSavingEdit}
                  onClick={() => setEditingMember(null)}
                >
                  Cancelar
                </button>
                <button type="submit" disabled={isSavingEdit}>
                  {isSavingEdit ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function importRejectionReasonLabel(reason: string): string {
  switch (reason) {
    case "missing_name":
      return "Nome ausente";
    case "name_too_long":
      return "Nome muito longo";
    case "invalid_communicant":
      return "Valor inválido para comungante (use sim ou não)";
    case "invalid_gender":
      return "Sexo inválido (use M, F ou deixe em branco)";
    case "invalid_birth_date":
      return "Data de nascimento inválida (use AAAA-MM-DD)";
    case "invalid_photo_url":
      return "URL ou caminho da foto inválido";
    case "invalid_society_flag":
      return "Valor inválido para UPA/UMP (use sim ou não)";
    case "invalid_society_date":
      return "Data de ingresso UPA/UMP inválida (use AAAA-MM-DD)";
    case "conflicting_societies":
      return "Ativo na UPA e na UMP ao mesmo tempo";
    default:
      return reason;
  }
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsText(file);
  });
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "SC";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toLocaleUpperCase("pt-BR");
  }
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toLocaleUpperCase("pt-BR");
}
