export const validateDateRange = (req, res, next) => {
  const { startDate, endDate } = req.query;

  // If no dates provided, continue
  if (!startDate && !endDate) {
    return next();
  }

  // If one date is provided but empty, remove it from query
  if (startDate === '') {
    delete req.query.startDate;
  }
  if (endDate === '') {
    delete req.query.endDate;
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (startDate && !dateRegex.test(startDate)) {
    return res.status(400).json({ message: "Invalid start date format" });
  }

  if (endDate && !dateRegex.test(endDate)) {
    return res.status(400).json({ message: "Invalid end date format" });
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return res.status(400).json({ message: "Start date cannot be after end date" });
  }

  next();
}; 