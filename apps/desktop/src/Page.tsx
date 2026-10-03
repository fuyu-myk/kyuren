import type { ReactNode } from "react";

type PageProps = {
  title: string;
  about?: string;
  back?: () => void;
  /// Given when the title is a session's name, which can be changed to something better.
  onRename?: (title: string) => void;
  children: ReactNode;
  composer?: ReactNode;
};

/// Every page is the same shape: what this place is at the top, the place itself in the middle,
/// and the bar to say something at the bottom. Moving between panes changes the top, and nothing
/// under the pointer moves.
export function Page({ title, about, back, onRename, children, composer }: PageProps) {
  return (
    <div className="page">
      <header className="page-head">
        {back ? (
          <button type="button" className="ghost back" onClick={back}>
            back
          </button>
        ) : null}
        <div className="page-name">
          {onRename ? (
            <input
              key={title}
              defaultValue={title}
              aria-label="what this session is called"
              onBlur={(event) => {
                const named = event.target.value.trim();
                if (named !== "" && named !== title) onRename(named);
              }}
            />
          ) : (
            <h2>{title}</h2>
          )}
          {about ? <p>{about}</p> : null}
        </div>
      </header>

      <div className="page-body">{children}</div>
      {composer}
    </div>
  );
}
