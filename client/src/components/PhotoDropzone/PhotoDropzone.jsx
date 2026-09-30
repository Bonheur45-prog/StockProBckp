import { useState } from "react";
import { ImagePlus } from "lucide-react";
import styles from "./PhotoDropzone.module.css";

export default function PhotoDropzone({ previewSrc, onFileSelected }) {
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (file && file.type.startsWith("image/")) {
      onFileSelected(file);
    }
  }

  return (
    <label
      className={styles.zone}
      data-dragover={dragOver}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {previewSrc ? (
        <img src={previewSrc} alt="" className={styles.preview} />
      ) : (
        <span className={styles.placeholder}>
          <ImagePlus size={18} />
          <span>Drop photo here or click to choose</span>
        </span>
      )}
      <input type="file" accept="image/*" hidden onChange={(e) => handleFiles(e.target.files)} />
    </label>
  );
}
