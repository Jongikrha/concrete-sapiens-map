// ============================================================
// 데이터 백업 (내보내기 / 가져오기)
// ============================================================
// localStorage는 이 브라우저에만 저장되고, 실수로 지우면(예:
// localStorage.clear()) 복구가 불가능하다. 나중에 실제 DB로 옮길 때도
// 이 JSON 파일을 그대로 업로드하는 방식으로 이어붙일 수 있도록,
// 별도 백엔드 없이 파일 하나로 안전하게 보관/복구할 수 있게 한다.
function exportBackup() {
  const stories = Storage.getAllStories();
  if (stories.length === 0) {
    alert("내보낼 기억이 아직 없습니다.");
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    source: "concrete-sapiens-map",
    count: stories.length,
    stories,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = `concrete-sapiens-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const importedStories = Array.isArray(payload) ? payload : payload.stories;

      if (!Array.isArray(importedStories)) {
        alert("올바른 백업 파일이 아닙니다.");
        return;
      }

      const existing = Storage.getAllStories();
      const existingIds = new Set(existing.map((s) => s.id));
      const merged = [...existing, ...importedStories.filter((s) => !existingIds.has(s.id))];

      Storage.saveAll(merged);
      alert(`${importedStories.length}개 중 ${merged.length - existing.length}개를 새로 불러왔습니다.`);
      renderMarkers();
      renderHashtagChips();
      openRecentMemoriesModal();
    } catch (err) {
      alert("파일을 읽는 중 오류가 발생했습니다. 올바른 JSON 백업 파일인지 확인해주세요.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}
