import { ArrowRight, Sparkle, X } from "@phosphor-icons/react";
import { useState } from "react";
import { TOPIC_CATEGORIES, type TopicCategory } from "../lib/topics";

/**
 * Bảng chủ đề: menu lĩnh vực bên trái, danh sách tiêu đề bên phải.
 *
 * Danh sách tĩnh nên mở ra là thấy ngay, không chờ AI và không tốn tiền. Chủ đề
 * được chọn theo tiêu chí có CHUỖI VẬN HÀNH nhìn thấy được — thứ paper-collage
 * dựng tốt vì mỗi công đoạn thành một lớp giấy.
 */
export function TopicPickerDialog({
  categories = TOPIC_CATEGORIES,
  onPick,
  onClose,
}: {
  categories?: TopicCategory[];
  onPick: (title: string, category: TopicCategory) => void;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(categories[0]?.id || "");
  const active = categories.find((c) => c.id === activeId) || categories[0];

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="topic-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topic-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="topic-title">Chọn chủ đề</h2>
            <p>
              Mười lĩnh vực hợp phong cách paper-collage, mỗi lĩnh vực mười tiêu
              đề đã kiểm qua góc kể.
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        <div className="topic-body">
          <nav className="topic-menu">
            {categories.map((category) => (
              <button
                key={category.id}
                className={category.id === active?.id ? "topic-menu-active" : ""}
                onClick={() => setActiveId(category.id)}
              >
                {category.label}
              </button>
            ))}
          </nav>

          <div className="topic-list">
            {active && (
              <>
                <p className="topic-blurb">
                  <Sparkle size={14} weight="fill" />
                  {active.blurb}
                </p>
                {active.titles.map((title) => (
                  <button
                    key={title}
                    className="topic-item"
                    onClick={() => onPick(title, active)}
                  >
                    <span>{title}</span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
