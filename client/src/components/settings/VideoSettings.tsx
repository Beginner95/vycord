export function VideoSettings() {
  return (
    <div className="settings-section">
      <h3>Video</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>Camera</label>
          <p className="setting-description">
            Select your camera
          </p>
        </div>
        <select className="setting-select">
          <option>Default Camera</option>
        </select>
      </div>
    </div>
  );
}
