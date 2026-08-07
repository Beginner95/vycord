package domain

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// Permission — битовая маска прав участника на сервере.
// Значения битов зафиксированы: они записываются в БД числами (roles.permissions
// BIGINT) и в миграции 011, поэтому переупорядочивать их нельзя.
type Permission uint64

const (
	// PermAdministrator обходит проверку любого права. Не обходит иерархию ролей
	// и действия, доступные только владельцу сервера.
	PermAdministrator Permission = 1 << 0
	// PermManageServer — переименование сервера, загрузка и удаление иконки.
	PermManageServer Permission = 1 << 1
	// PermManageRoles — CRUD ролей, назначение и снятие ролей участникам.
	PermManageRoles Permission = 1 << 2
	// PermManageChannels — создание, переименование и удаление каналов.
	PermManageChannels Permission = 1 << 3
	// PermViewChannels — список каналов и участников, чтение и поиск сообщений.
	PermViewChannels Permission = 1 << 4
	// PermSendMessages — отправка, правка и удаление собственных сообщений.
	PermSendMessages Permission = 1 << 5
	// PermMentionEveryone — упоминание @everyone в сообщении.
	PermMentionEveryone Permission = 1 << 6
	// PermCreateInvite — создание инвайт-ссылок на сервер (аналог Discord
	// CREATE_INSTANT_INVITE). Не путать с приватностью сервера: приватность
	// решает, обнаруживаем ли сервер и нужен ли инвайт вообще; это право
	// решает, кто может тот инвайт выпустить.
	PermCreateInvite Permission = 1 << 7

	// PermAll — объединение всех известных прав. Всё, что вне этой маски,
	// считается невалидным: иначе «застолблённые» неизвестные биты внезапно
	// обрели бы смысл при добавлении нового права.
	PermAll = PermAdministrator | PermManageServer | PermManageRoles |
		PermManageChannels | PermViewChannels | PermSendMessages | PermMentionEveryone | PermCreateInvite
)

// IsValid сообщает, что маска не содержит битов вне PermAll.
func (p Permission) IsValid() bool {
	return p&^PermAll == 0
}

// MarshalJSON отдаёт маску десятичной строкой, а не числом: 64-битные значения
// не переживают JSON-число в JavaScript-клиенте.
func (p Permission) MarshalJSON() ([]byte, error) {
	return []byte(`"` + strconv.FormatUint(uint64(p), 10) + `"`), nil
}

func (p *Permission) UnmarshalJSON(data []byte) error {
	// Сначала распаковываем именно как JSON-строку: голое число (например, `64`
	// вместо `"64"`) обязано быть отвергнуто, иначе строковый контракт из
	// MarshalJSON ничего не защищает.
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid permissions value %q", string(data))
	}
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid permissions value %q", s)
	}
	*p = Permission(v)
	return nil
}

// PermissionSet — эффективные права пользователя на конкретном сервере.
type PermissionSet struct {
	// IsOwner — пользователь владелец сервера. Короткозамыкает Has(): владельца
	// невозможно ограничить ролью или лишить прав удалением роли.
	IsOwner bool `json:"is_owner"`
	// Bits — объединение прав роли @everyone и всех назначенных ролей.
	Bits Permission `json:"permissions"`
	// HighestPosition — позиция самой высокой роли участника. У участника без
	// назначенных ролей это 0 (позиция @everyone). -1 означает, что дефолтной
	// роли на сервере нет — состояние, невозможное после миграции 011.
	HighestPosition int `json:"highest_position"`
}

// Has сообщает, разрешено ли пользователю действие, требующее perm.
func (p PermissionSet) Has(perm Permission) bool {
	if p.IsOwner {
		return true
	}
	if p.Bits&PermAdministrator != 0 {
		return true
	}
	return p.Bits&perm != 0
}
