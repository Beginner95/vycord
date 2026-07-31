-- +migrate Down
DELETE FROM roles WHERE is_default OR name = 'Administrator'
